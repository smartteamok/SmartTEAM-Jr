#include "stx_vm.h"

/* Longitud total (opcode + operandos) de cada instrucción; 0 = inválida */
static uint8_t instr_len(uint8_t op) {
    switch (op) {
        case STX_OP_NOP:          return 1;
        case STX_OP_HALT:         return 1;
        case STX_OP_WAIT_MS:      return 3;
        case STX_OP_LOOP_N:       return 2;
        case STX_OP_LOOP_END:     return 1;
        case STX_OP_LOOP_FOREVER: return 1;
        case STX_OP_WAIT_UNTIL:   return 3;
        case STX_OP_LED_PATTERN:  return 5;
        case STX_OP_LED_CLEAR:    return 1;
        case STX_OP_LED_BRIGHT:   return 2;
        case STX_OP_RGB_SET:      return 4;
        case STX_OP_TONE:         return 4;
        case STX_OP_TONE_STOP:    return 1;
        case STX_OP_MOTORS:       return 3;
        case STX_OP_MOTORS_TICKS: return 5;
        case STX_OP_MOTORS_STOP:  return 1;
        default:                  return 0; /* JMP reservado y desconocidos */
    }
}

static uint16_t rd_u16(const uint8_t *p) {
    return (uint16_t)(p[0] | (p[1] << 8));
}

static void vm_fault(stx_vm_t *vm, uint8_t err) {
    vm->last_error = err;
    stx_vm_stop(vm);
}

void stx_vm_init(stx_vm_t *vm, const stx_hal_t *hal) {
    vm->hal = hal;
    vm->loaded = false;
    vm->state = STX_VMSTATE_STOPPED;
    vm->last_error = STX_ERR_NONE;
    for (int i = 0; i < STX_MAX_CONTEXTS; i++) {
        vm->ctx[i].state = STX_CTX_IDLE;
    }
}

uint8_t stx_vm_load(stx_vm_t *vm, const uint8_t *image_buf, uint16_t len) {
    stx_vm_stop(vm);
    vm->loaded = false;
    uint8_t err = stx_image_parse(image_buf, len, &vm->image);
    if (err != STX_ERR_NONE) {
        vm->last_error = err;
        return err;
    }
    vm->loaded = true;
    vm->last_error = STX_ERR_NONE;
    return STX_ERR_NONE;
}

bool stx_vm_start(stx_vm_t *vm) {
    if (!vm->loaded) {
        return false;
    }
    stx_vm_stop(vm);
    vm->last_error = STX_ERR_NONE;
    uint8_t assigned = 0;
    for (uint8_t i = 0; i < vm->image.event_count && assigned < STX_MAX_CONTEXTS; i++) {
        stx_event_entry_t ev;
        stx_image_event(&vm->image, i, &ev);
        stx_context_t *c = &vm->ctx[assigned++];
        c->event_type = ev.type;
        c->event_param = ev.param;
        c->entry = ev.offset;
        c->pc = ev.offset;
        c->loop_depth = 0;
        c->state = (ev.type == STX_EVT_ON_START) ? STX_CTX_READY : STX_CTX_ARMED;
    }
    vm->state = STX_VMSTATE_RUNNING;
    return true;
}

void stx_vm_stop(stx_vm_t *vm) {
    for (int i = 0; i < STX_MAX_CONTEXTS; i++) {
        vm->ctx[i].state = STX_CTX_IDLE;
    }
    if (vm->state == STX_VMSTATE_RUNNING && vm->hal != 0) {
        if (vm->hal->tone_stop != 0) vm->hal->tone_stop();
        if (vm->hal->motors_stop != 0) vm->hal->motors_stop();
        if (vm->hal->led_clear != 0) vm->hal->led_clear();
    }
    vm->state = STX_VMSTATE_STOPPED;
}

static bool event_cond(const stx_vm_t *vm, const stx_context_t *c) {
    uint8_t cond;
    switch (c->event_type) {
        case STX_EVT_ON_DARK:     cond = STX_COND_DARK; break;
        case STX_EVT_ON_LOUD:     cond = STX_COND_LOUD; break;
        case STX_EVT_ON_BUTTON_A: cond = STX_COND_BTN_A; break;
        case STX_EVT_ON_BUTTON_B: cond = STX_COND_BTN_B; break;
        default: return false;
    }
    return vm->hal->read_cond(cond, c->event_param);
}

/* Ejecuta una instrucción del código en el contexto c. Devuelve true si el
 * contexto puede seguir ejecutando dentro del mismo tick. */
static bool step(stx_vm_t *vm, stx_context_t *c) {
    const stx_image_t *img = &vm->image;
    if (c->pc >= img->code_len) {
        vm_fault(vm, STX_ERR_PC_RANGE);
        return false;
    }
    const uint8_t *p = img->code + c->pc;
    uint8_t op = p[0];
    uint8_t len = instr_len(op);
    if (len == 0 || c->pc + len > img->code_len) {
        vm_fault(vm, (len == 0) ? STX_ERR_BAD_OPCODE : STX_ERR_PC_RANGE);
        return false;
    }
    const stx_hal_t *hal = vm->hal;

    switch (op) {
        case STX_OP_NOP:
            break;
        case STX_OP_HALT:
            if (c->event_type == STX_EVT_ON_START) {
                c->state = STX_CTX_IDLE;
            } else {
                /* evento: re-armar tras condición falsa + debounce */
                c->state = STX_CTX_REARM;
                c->deadline = hal->now_ms() + STX_EVENT_DEBOUNCE_MS;
            }
            return false;
        case STX_OP_WAIT_MS:
            c->deadline = hal->now_ms() + rd_u16(p + 1);
            c->state = STX_CTX_WAIT_MS;
            c->pc += len;
            return false;
        case STX_OP_LOOP_N:
        case STX_OP_LOOP_FOREVER:
            if (c->loop_depth >= STX_MAX_LOOP_DEPTH) {
                vm_fault(vm, STX_ERR_LOOP_OVERFLOW);
                return false;
            }
            c->loops[c->loop_depth].start_pc = c->pc + len;
            c->loops[c->loop_depth].count = (op == STX_OP_LOOP_N) ? p[1] : 0;
            c->loop_depth++;
            break;
        case STX_OP_LOOP_END: {
            if (c->loop_depth == 0) {
                vm_fault(vm, STX_ERR_LOOP_UNDERFLOW);
                return false;
            }
            stx_loop_frame_t *f = &c->loops[c->loop_depth - 1];
            if (f->count == 0) {           /* forever */
                c->pc = f->start_pc;
                return true;
            }
            f->count--;
            if (f->count > 0) {
                c->pc = f->start_pc;
                return true;
            }
            c->loop_depth--;
            break;
        }
        case STX_OP_WAIT_UNTIL:
            if (!hal->read_cond(p[1], p[2])) {
                c->wait_cond = p[1];
                c->wait_param = p[2];
                c->state = STX_CTX_WAIT_COND;
                c->pc += len;
                return false;
            }
            break;
        case STX_OP_LED_PATTERN: {
            uint32_t bits = (uint32_t)p[1] | ((uint32_t)p[2] << 8) |
                            ((uint32_t)p[3] << 16) | ((uint32_t)p[4] << 24);
            hal->led_pattern(bits);
            break;
        }
        case STX_OP_LED_CLEAR:
            hal->led_clear();
            break;
        case STX_OP_LED_BRIGHT:
            hal->led_brightness(p[1]);
            break;
        case STX_OP_RGB_SET:
            hal->rgb(p[1], p[2], p[3]);
            break;
        case STX_OP_TONE:
            hal->tone(p[1], rd_u16(p + 2));
            break;
        case STX_OP_TONE_STOP:
            hal->tone_stop();
            break;
        case STX_OP_MOTORS:
            if (hal->motors == 0) { vm_fault(vm, STX_ERR_BAD_OPCODE); return false; }
            hal->motors((int8_t)p[1], (int8_t)p[2]);
            break;
        case STX_OP_MOTORS_TICKS:
            if (hal->motors_ticks == 0) { vm_fault(vm, STX_ERR_BAD_OPCODE); return false; }
            hal->motors_ticks((int8_t)p[1], (int8_t)p[2], rd_u16(p + 3));
            break;
        case STX_OP_MOTORS_STOP:
            if (hal->motors_stop == 0) { vm_fault(vm, STX_ERR_BAD_OPCODE); return false; }
            hal->motors_stop();
            break;
        default:
            vm_fault(vm, STX_ERR_BAD_OPCODE);
            return false;
    }
    c->pc += len;
    return true;
}

void stx_vm_tick(stx_vm_t *vm) {
    if (vm->state != STX_VMSTATE_RUNNING) {
        return;
    }
    uint32_t now = vm->hal->now_ms();
    for (int i = 0; i < STX_MAX_CONTEXTS; i++) {
        stx_context_t *c = &vm->ctx[i];
        switch (c->state) {
            case STX_CTX_IDLE:
                continue;
            case STX_CTX_ARMED:
                if (event_cond(vm, c)) {
                    c->pc = c->entry;
                    c->loop_depth = 0;
                    c->state = STX_CTX_READY;
                } else {
                    continue;
                }
                break;
            case STX_CTX_REARM:
                /* re-armar cuando la condición volvió a ser falsa y pasó el debounce */
                if ((int32_t)(now - c->deadline) >= 0 && !event_cond(vm, c)) {
                    c->state = STX_CTX_ARMED;
                }
                continue;
            case STX_CTX_WAIT_MS:
                if ((int32_t)(now - c->deadline) >= 0) {
                    c->state = STX_CTX_READY;
                } else {
                    continue;
                }
                break;
            case STX_CTX_WAIT_COND:
                if (vm->hal->read_cond(c->wait_cond, c->wait_param)) {
                    c->state = STX_CTX_READY;
                } else {
                    continue;
                }
                break;
            case STX_CTX_READY:
                break;
        }
        for (int budget = 0; budget < STX_TICK_BUDGET; budget++) {
            if (c->state != STX_CTX_READY || !step(vm, c)) {
                break;
            }
            if (vm->state != STX_VMSTATE_RUNNING) {
                return; /* un fault detuvo todo */
            }
        }
    }
}

uint8_t stx_vm_exec_one(stx_vm_t *vm, const uint8_t *instr, uint8_t len) {
    if (len == 0) {
        return STX_ERR_BAD_OPCODE;
    }
    uint8_t op = instr[0];
    uint8_t need = instr_len(op);
    if (need == 0 || need != len) {
        return STX_ERR_BAD_OPCODE;
    }
    /* solo actuadores en modo live: nada de control/esperas */
    switch (op) {
        case STX_OP_LED_PATTERN:
        case STX_OP_LED_CLEAR:
        case STX_OP_LED_BRIGHT:
        case STX_OP_RGB_SET:
        case STX_OP_TONE:
        case STX_OP_TONE_STOP:
        case STX_OP_MOTORS:
        case STX_OP_MOTORS_TICKS:
        case STX_OP_MOTORS_STOP:
            break;
        default:
            return STX_ERR_BAD_OPCODE;
    }
    /* contexto efímero sobre un mini-código: la instrucción + HALT */
    const stx_hal_t *hal = vm->hal;
    const uint8_t *p = instr;
    switch (op) {
        case STX_OP_LED_PATTERN: {
            uint32_t bits = (uint32_t)p[1] | ((uint32_t)p[2] << 8) |
                            ((uint32_t)p[3] << 16) | ((uint32_t)p[4] << 24);
            hal->led_pattern(bits);
            break;
        }
        case STX_OP_LED_CLEAR:   hal->led_clear(); break;
        case STX_OP_LED_BRIGHT:  hal->led_brightness(p[1]); break;
        case STX_OP_RGB_SET:     hal->rgb(p[1], p[2], p[3]); break;
        case STX_OP_TONE:        hal->tone(p[1], rd_u16(p + 2)); break;
        case STX_OP_TONE_STOP:   hal->tone_stop(); break;
        case STX_OP_MOTORS:
            if (hal->motors == 0) return STX_ERR_BAD_OPCODE;
            hal->motors((int8_t)p[1], (int8_t)p[2]);
            break;
        case STX_OP_MOTORS_TICKS:
            if (hal->motors_ticks == 0) return STX_ERR_BAD_OPCODE;
            hal->motors_ticks((int8_t)p[1], (int8_t)p[2], rd_u16(p + 3));
            break;
        case STX_OP_MOTORS_STOP:
            if (hal->motors_stop == 0) return STX_ERR_BAD_OPCODE;
            hal->motors_stop();
            break;
    }
    return STX_ERR_NONE;
}
