/*
 * test_vm.c — Tests de host de la VM STX (gcc nativo, sin CODAL).
 * Corre con: make -C firmware/tests/host test
 */
#include <stdio.h>
#include <string.h>
#include "../../source/vm/stx_vm.h"
#include "fake_hal.h"

static int failures = 0;
static int checks = 0;

#define CHECK(cond) do { \
    checks++; \
    if (!(cond)) { \
        failures++; \
        printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); \
    } \
} while (0)

/* ---- Builder de imágenes STX1 para los tests ---- */

typedef struct {
    uint8_t type, param;
    uint16_t offset;
} ev_t;

static uint16_t build_image(uint8_t *buf, const ev_t *events, uint8_t nev,
                            const uint8_t *code, uint16_t code_len) {
    buf[0] = STX_MAGIC_0; buf[1] = STX_MAGIC_1;
    buf[2] = STX_MAGIC_2; buf[3] = STX_MAGIC_3;
    buf[4] = STX_BC_VERSION;
    buf[5] = nev;
    buf[6] = code_len & 0xFF;
    buf[7] = (code_len >> 8) & 0xFF;
    uint16_t pos = STX_HEADER_SIZE;
    for (uint8_t i = 0; i < nev; i++) {
        buf[pos++] = events[i].type;
        buf[pos++] = events[i].param;
        buf[pos++] = events[i].offset & 0xFF;
        buf[pos++] = (events[i].offset >> 8) & 0xFF;
    }
    memcpy(buf + pos, code, code_len);
    uint16_t total = pos + code_len;
    uint32_t crc = stx_crc32(buf + STX_HEADER_SIZE, total - STX_HEADER_SIZE);
    buf[8] = crc & 0xFF;
    buf[9] = (crc >> 8) & 0xFF;
    buf[10] = (crc >> 16) & 0xFF;
    buf[11] = (crc >> 24) & 0xFF;
    return total;
}

static uint16_t build_start_image(uint8_t *buf, const uint8_t *code, uint16_t code_len) {
    ev_t ev = { STX_EVT_ON_START, 0, 0 };
    return build_image(buf, &ev, 1, code, code_len);
}

/* Corre ticks hasta que ningún contexto esté READY (o max_ticks) */
static void run_until_quiet(stx_vm_t *vm, int max_ticks) {
    for (int t = 0; t < max_ticks; t++) {
        stx_vm_tick(vm);
        bool ready = false;
        for (int i = 0; i < STX_MAX_CONTEXTS; i++) {
            if (vm->ctx[i].state == STX_CTX_READY) ready = true;
        }
        if (!ready) return;
    }
}

/* ---- Tests ---- */

static void test_image_validation(void) {
    uint8_t buf[64];
    stx_image_t img;
    const uint8_t code[] = { STX_OP_HALT };
    uint16_t len = build_start_image(buf, code, sizeof(code));

    CHECK(stx_image_parse(buf, len, &img) == STX_ERR_NONE);
    CHECK(img.event_count == 1);
    CHECK(img.code_len == 1);

    buf[0] = 'X'; /* magic roto */
    CHECK(stx_image_parse(buf, len, &img) == STX_ERR_BAD_IMAGE);
    buf[0] = STX_MAGIC_0;

    buf[len - 1] ^= 0xFF; /* CRC roto */
    CHECK(stx_image_parse(buf, len, &img) == STX_ERR_BAD_IMAGE);
    buf[len - 1] ^= 0xFF;

    CHECK(stx_image_parse(buf, len - 1, &img) == STX_ERR_BAD_IMAGE); /* corta */
    CHECK(stx_image_parse(buf, 4, &img) == STX_ERR_BAD_IMAGE);
}

static void test_simple_sequence(void) {
    /* LED_PATTERN(smiley) + WAIT 100 + LED_CLEAR + HALT */
    const uint8_t code[] = {
        STX_OP_LED_PATTERN, 0x40, 0x81, 0xE8, 0x00,
        STX_OP_WAIT_MS, 100, 0,
        STX_OP_LED_CLEAR,
        STX_OP_HALT
    };
    uint8_t buf[64];
    uint16_t len = build_start_image(buf, code, sizeof(code));

    fake_reset();
    stx_vm_t vm;
    stx_vm_init(&vm, &fake_hal);
    CHECK(stx_vm_load(&vm, buf, len) == STX_ERR_NONE);
    CHECK(stx_vm_start(&vm));

    stx_vm_tick(&vm);
    CHECK(fake_trace_len == 1);
    CHECK(fake_trace[0].type == T_LED_PATTERN);
    CHECK(fake_trace[0].a == 0x00E88140u);

    stx_vm_tick(&vm); /* aún esperando */
    CHECK(fake_trace_len == 1);

    fake_advance(100);
    stx_vm_tick(&vm);
    CHECK(fake_trace_len == 2);
    CHECK(fake_trace[1].type == T_LED_CLEAR);
    /* v2: al quedar todos los contextos IDLE la VM pasa a STOPPED (fin
     * natural) sin apagar actuadores */
    CHECK(vm.state == STX_VMSTATE_STOPPED);
    CHECK(vm.ctx[0].state == STX_CTX_IDLE);
    CHECK(vm.last_error == STX_ERR_NONE);
    CHECK(fake_trace_len == 2); /* sin led_clear/tone_stop extra del stop */
}

static void test_nested_loops(void) {
    /* LOOP_N 2 { LOOP_N 3 { TONE 60,10 ; WAIT 10 } } HALT -> 6 tonos */
    const uint8_t code[] = {
        STX_OP_LOOP_N, 2,
        STX_OP_LOOP_N, 3,
        STX_OP_TONE, 60, 10, 0,
        STX_OP_WAIT_MS, 10, 0,
        STX_OP_LOOP_END,
        STX_OP_LOOP_END,
        STX_OP_HALT
    };
    uint8_t buf[64];
    uint16_t len = build_start_image(buf, code, sizeof(code));

    fake_reset();
    stx_vm_t vm;
    stx_vm_init(&vm, &fake_hal);
    stx_vm_load(&vm, buf, len);
    stx_vm_start(&vm);

    for (int i = 0; i < 20; i++) {
        stx_vm_tick(&vm);
        fake_advance(10);
    }
    int tones = 0;
    for (int i = 0; i < fake_trace_len; i++) {
        if (fake_trace[i].type == T_TONE) tones++;
    }
    CHECK(tones == 6);
    CHECK(vm.ctx[0].state == STX_CTX_IDLE);
    CHECK(vm.last_error == STX_ERR_NONE);
}

static void test_forever_budget(void) {
    /* FOREVER { LED_CLEAR } — sin waits: el presupuesto por tick debe acotar */
    const uint8_t code[] = {
        STX_OP_LOOP_FOREVER,
        STX_OP_LED_CLEAR,
        STX_OP_LOOP_END,
        STX_OP_HALT
    };
    uint8_t buf[64];
    uint16_t len = build_start_image(buf, code, sizeof(code));

    fake_reset();
    stx_vm_t vm;
    stx_vm_init(&vm, &fake_hal);
    stx_vm_load(&vm, buf, len);
    stx_vm_start(&vm);

    stx_vm_tick(&vm);
    int after_one_tick = fake_trace_len;
    CHECK(after_one_tick > 0);
    CHECK(after_one_tick <= STX_TICK_BUDGET);

    stx_vm_tick(&vm); /* sigue corriendo en el siguiente tick */
    CHECK(fake_trace_len > after_one_tick);
    CHECK(vm.state == STX_VMSTATE_RUNNING);
}

static void test_event_edge_trigger(void) {
    /* handler ON_START vacío + ON_DARK { TONE } */
    const uint8_t code[] = {
        STX_OP_HALT,                 /* offset 0: start */
        STX_OP_TONE, 60, 10, 0,      /* offset 1: dark handler */
        STX_OP_HALT
    };
    ev_t events[] = {
        { STX_EVT_ON_START, 0, 0 },
        { STX_EVT_ON_DARK, 5, 1 }
    };
    uint8_t buf[64];
    uint16_t len = build_image(buf, events, 2, code, sizeof(code));

    fake_reset();
    stx_vm_t vm;
    stx_vm_init(&vm, &fake_hal);
    CHECK(stx_vm_load(&vm, buf, len) == STX_ERR_NONE);
    stx_vm_start(&vm);

    stx_vm_tick(&vm);
    CHECK(fake_trace_len == 0); /* oscuro=false: no dispara */

    fake_conds[STX_COND_DARK] = true;
    stx_vm_tick(&vm);
    CHECK(fake_trace_len == 1); /* disparó una vez */

    stx_vm_tick(&vm);
    stx_vm_tick(&vm);
    CHECK(fake_trace_len == 1); /* condición sigue true: NO re-dispara (flanco) */

    /* condición vuelve a false pero sin esperar el debounce */
    fake_conds[STX_COND_DARK] = false;
    fake_advance(100);
    stx_vm_tick(&vm);
    fake_conds[STX_COND_DARK] = true;
    stx_vm_tick(&vm);
    CHECK(fake_trace_len == 1); /* dentro del debounce: no re-armó */

    fake_conds[STX_COND_DARK] = false;
    fake_advance(600);
    stx_vm_tick(&vm); /* re-arma */
    fake_conds[STX_COND_DARK] = true;
    stx_vm_tick(&vm);
    CHECK(fake_trace_len == 2); /* segundo disparo */
}

static void test_wait_until(void) {
    const uint8_t code[] = {
        STX_OP_WAIT_UNTIL, STX_COND_LOUD, 50,
        STX_OP_LED_CLEAR,
        STX_OP_HALT
    };
    uint8_t buf[64];
    uint16_t len = build_start_image(buf, code, sizeof(code));

    fake_reset();
    stx_vm_t vm;
    stx_vm_init(&vm, &fake_hal);
    stx_vm_load(&vm, buf, len);
    stx_vm_start(&vm);

    stx_vm_tick(&vm);
    stx_vm_tick(&vm);
    CHECK(fake_trace_len == 0);

    fake_conds[STX_COND_LOUD] = true;
    stx_vm_tick(&vm);
    CHECK(fake_trace_len == 1);
    CHECK(fake_trace[0].type == T_LED_CLEAR);
}

static void test_runtime_fault_stops_and_silences(void) {
    /* opcode inválido 0x7F: fault + apagar actuadores */
    const uint8_t code[] = { 0x7F, STX_OP_HALT };
    uint8_t buf[64];
    uint16_t len = build_start_image(buf, code, sizeof(code));

    fake_reset();
    stx_vm_t vm;
    stx_vm_init(&vm, &fake_hal);
    stx_vm_load(&vm, buf, len);
    stx_vm_start(&vm);
    stx_vm_tick(&vm);

    CHECK(vm.state == STX_VMSTATE_STOPPED);
    CHECK(vm.last_error == STX_ERR_BAD_OPCODE);
    /* stop apaga: tone_stop + motors_stop + led_clear */
    bool saw_tone_stop = false, saw_led_clear = false;
    for (int i = 0; i < fake_trace_len; i++) {
        if (fake_trace[i].type == T_TONE_STOP) saw_tone_stop = true;
        if (fake_trace[i].type == T_LED_CLEAR) saw_led_clear = true;
    }
    CHECK(saw_tone_stop);
    CHECK(saw_led_clear);
}

static void test_loop_overflow(void) {
    uint8_t code[32];
    int n = 0;
    for (int i = 0; i < STX_MAX_LOOP_DEPTH + 1; i++) {
        code[n++] = STX_OP_LOOP_FOREVER;
    }
    code[n++] = STX_OP_HALT;
    uint8_t buf[64];
    uint16_t len = build_start_image(buf, code, n);

    fake_reset();
    stx_vm_t vm;
    stx_vm_init(&vm, &fake_hal);
    stx_vm_load(&vm, buf, len);
    stx_vm_start(&vm);
    run_until_quiet(&vm, 5);
    CHECK(vm.state == STX_VMSTATE_STOPPED);
    CHECK(vm.last_error == STX_ERR_LOOP_OVERFLOW);
}

static void test_motors_rejected_onboard(void) {
    const uint8_t code[] = {
        STX_OP_MOTORS, 50, 50,
        STX_OP_HALT
    };
    uint8_t buf[64];
    uint16_t len = build_start_image(buf, code, sizeof(code));

    fake_reset();
    stx_vm_t vm;
    stx_vm_init(&vm, &fake_hal_onboard); /* HAL sin motores */
    stx_vm_load(&vm, buf, len);
    stx_vm_start(&vm);
    stx_vm_tick(&vm);
    CHECK(vm.state == STX_VMSTATE_STOPPED);
    CHECK(vm.last_error == STX_ERR_BAD_OPCODE);
}

static void test_exec_one_live(void) {
    fake_reset();
    stx_vm_t vm;
    stx_vm_init(&vm, &fake_hal);

    const uint8_t rgb[] = { STX_OP_RGB_SET, 255, 0, 128 };
    CHECK(stx_vm_exec_one(&vm, rgb, sizeof(rgb)) == STX_ERR_NONE);
    CHECK(fake_trace_len == 1);
    CHECK(fake_trace[0].type == T_RGB);
    CHECK(fake_trace[0].a == 255 && fake_trace[0].b == 0 && fake_trace[0].c == 128);

    const uint8_t wait[] = { STX_OP_WAIT_MS, 100, 0 };
    CHECK(stx_vm_exec_one(&vm, wait, sizeof(wait)) == STX_ERR_BAD_OPCODE);

    const uint8_t truncated[] = { STX_OP_RGB_SET, 255 };
    CHECK(stx_vm_exec_one(&vm, truncated, sizeof(truncated)) == STX_ERR_BAD_OPCODE);
}

static void test_multi_start_contexts(void) {
    /* dos handlers ON_START concurrentes: TONE en offset 0, LED_CLEAR en 5 */
    const uint8_t code[] = {
        STX_OP_TONE, 60, 10, 0, STX_OP_HALT,   /* offsets 0-4 */
        STX_OP_LED_CLEAR, STX_OP_HALT          /* offsets 5-6 */
    };
    ev_t events[] = {
        { STX_EVT_ON_START, 0, 0 },
        { STX_EVT_ON_START, 0, 5 }
    };
    uint8_t buf[64];
    uint16_t len = build_image(buf, events, 2, code, sizeof(code));

    fake_reset();
    stx_vm_t vm;
    stx_vm_init(&vm, &fake_hal);
    CHECK(stx_vm_load(&vm, buf, len) == STX_ERR_NONE);
    stx_vm_start(&vm);
    stx_vm_tick(&vm);
    CHECK(fake_trace_len == 2); /* ambos corrieron en el mismo tick */
}

/* ---- Hook de notificación (v2: OP_MARK / DONE / FAULT) ---- */

#define NOTIF_LOG_MAX 16
static struct { uint8_t evt, arg; } notif_log[NOTIF_LOG_MAX];
static int notif_len = 0;

static void capture_notify(uint8_t evt, uint8_t arg) {
    if (notif_len < NOTIF_LOG_MAX) {
        notif_log[notif_len].evt = evt;
        notif_log[notif_len].arg = arg;
        notif_len++;
    }
}

static void test_mark_fires_hook(void) {
    const uint8_t code[] = {
        STX_OP_MARK, 5,
        STX_OP_LED_CLEAR,
        STX_OP_MARK, 6,
        STX_OP_HALT
    };
    uint8_t buf[64];
    uint16_t len = build_start_image(buf, code, sizeof(code));
    fake_reset();
    notif_len = 0;
    stx_vm_t vm;
    stx_vm_init(&vm, &fake_hal);
    vm.notify = capture_notify;
    CHECK(stx_vm_load(&vm, buf, len) == STX_ERR_NONE);
    stx_vm_start(&vm);
    stx_vm_tick(&vm);
    /* MARK 5, MARK 6 y DONE (todos los contextos quedaron IDLE) en orden */
    CHECK(notif_len == 3);
    CHECK(notif_log[0].evt == STX_VM_EVT_MARK && notif_log[0].arg == 5);
    CHECK(notif_log[1].evt == STX_VM_EVT_MARK && notif_log[1].arg == 6);
    CHECK(notif_log[2].evt == STX_VM_EVT_DONE && notif_log[2].arg == 0);
    CHECK(vm.state == STX_VMSTATE_STOPPED);
    /* fin natural: NO se apagan actuadores (solo quedó el led_clear del programa) */
    CHECK(fake_trace_len == 1 && fake_trace[0].type == T_LED_CLEAR);
}

static void test_mark_without_hook_is_noop(void) {
    const uint8_t code[] = { STX_OP_MARK, 1, STX_OP_HALT };
    uint8_t buf[64];
    uint16_t len = build_start_image(buf, code, sizeof(code));
    fake_reset();
    stx_vm_t vm;
    stx_vm_init(&vm, &fake_hal); /* notify queda NULL */
    CHECK(stx_vm_load(&vm, buf, len) == STX_ERR_NONE);
    stx_vm_start(&vm);
    stx_vm_tick(&vm); /* no debe crashear */
    CHECK(vm.state == STX_VMSTATE_STOPPED);
}

static void test_no_done_while_event_armed(void) {
    /* un handler ON_START que termina + un hat ON_DARK armado: nunca DONE */
    const uint8_t code[] = {
        STX_OP_LED_CLEAR, STX_OP_HALT,  /* handler start (offset 0) */
        STX_OP_TONE, 60, 100, 0, STX_OP_HALT  /* handler dark (offset 2) */
    };
    ev_t evs[2] = {
        { STX_EVT_ON_START, 0, 0 },
        { STX_EVT_ON_DARK, 50, 2 }
    };
    uint8_t buf[96];
    uint16_t len = build_image(buf, evs, 2, code, sizeof(code));
    fake_reset();
    notif_len = 0;
    stx_vm_t vm;
    stx_vm_init(&vm, &fake_hal);
    vm.notify = capture_notify;
    CHECK(stx_vm_load(&vm, buf, len) == STX_ERR_NONE);
    stx_vm_start(&vm);
    for (int i = 0; i < 10; i++) {
        stx_vm_tick(&vm);
        fake_advance(10);
    }
    CHECK(vm.state == STX_VMSTATE_RUNNING); /* sigue viva esperando el evento */
    for (int i = 0; i < notif_len; i++) {
        CHECK(notif_log[i].evt != STX_VM_EVT_DONE);
    }
}

static void test_fault_fires_hook(void) {
    const uint8_t code[] = { STX_OP_LOOP_END }; /* underflow */
    uint8_t buf[64];
    uint16_t len = build_start_image(buf, code, sizeof(code));
    fake_reset();
    notif_len = 0;
    stx_vm_t vm;
    stx_vm_init(&vm, &fake_hal);
    vm.notify = capture_notify;
    CHECK(stx_vm_load(&vm, buf, len) == STX_ERR_NONE);
    stx_vm_start(&vm);
    stx_vm_tick(&vm);
    CHECK(notif_len == 1);
    CHECK(notif_log[0].evt == STX_VM_EVT_FAULT);
    CHECK(notif_log[0].arg == STX_ERR_LOOP_UNDERFLOW);
}

static void test_exec_one_rejects_mark(void) {
    fake_reset();
    stx_vm_t vm;
    stx_vm_init(&vm, &fake_hal);
    const uint8_t mark[2] = { STX_OP_MARK, 3 };
    CHECK(stx_vm_exec_one(&vm, mark, 2) == STX_ERR_BAD_OPCODE);
}

int main(void) {
    test_image_validation();
    test_simple_sequence();
    test_nested_loops();
    test_forever_budget();
    test_event_edge_trigger();
    test_wait_until();
    test_runtime_fault_stops_and_silences();
    test_loop_overflow();
    test_motors_rejected_onboard();
    test_exec_one_live();
    test_multi_start_contexts();
    test_mark_fires_hook();
    test_mark_without_hook_is_noop();
    test_no_done_while_event_armed();
    test_fault_fires_hook();
    test_exec_one_rejects_mark();

    printf("%d checks, %d failures\n", checks, failures);
    return failures == 0 ? 0 : 1;
}
