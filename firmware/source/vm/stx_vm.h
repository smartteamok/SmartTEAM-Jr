/*
 * stx_vm.h — Intérprete cooperativo multi-contexto de bytecode STX1.
 * C portable, sin CODAL: todo I/O pasa por stx_hal_t.
 *
 * Uso desde el firmware:
 *   stx_vm_init(&vm, &hal);
 *   stx_vm_load(&vm, image_buf, image_len);   // valida y prepara
 *   stx_vm_start(&vm);                        // dispara ON_START, arma eventos
 *   loop { stx_vm_tick(&vm); uBit.sleep(5); } // desde el fiber principal
 *
 * Cada evento de la imagen ocupa un contexto (máx STX_MAX_CONTEXTS). Los
 * contextos de eventos con condición (DARK/LOUD/BUTTON) quedan armados y
 * disparan por flanco (la condición debe volver a ser falsa + debounce antes
 * de re-armarse). Errores de runtime detienen la VM y quedan en last_error.
 */
#ifndef STX_VM_H
#define STX_VM_H

#include <stdint.h>
#include <stdbool.h>
#include "stx_isa.h"
#include "stx_image.h"
#include "../hal/stx_hal.h"

#define STX_EVENT_DEBOUNCE_MS 500  /* re-armado de eventos por flanco */
#define STX_TICK_BUDGET 32         /* instrucciones máx por contexto por tick */

typedef enum {
    STX_CTX_IDLE = 0,     /* sin uso */
    STX_CTX_ARMED,        /* evento esperando su condición */
    STX_CTX_READY,        /* ejecutando */
    STX_CTX_WAIT_MS,      /* esperando deadline */
    STX_CTX_WAIT_COND,    /* esperando condición (WAIT_UNTIL) */
    STX_CTX_REARM         /* handler terminado; espera condición falsa + debounce */
} stx_ctx_state_t;

typedef struct stx_loop_frame {
    uint16_t start_pc;
    uint16_t count;       /* 0 = infinito */
} stx_loop_frame_t;

typedef struct stx_context {
    stx_ctx_state_t state;
    uint16_t pc;
    uint16_t entry;             /* offset inicial del handler */
    uint8_t event_type;         /* STX_EVT_* */
    uint8_t event_param;
    uint32_t deadline;          /* para WAIT_MS y debounce de REARM */
    uint8_t wait_cond;          /* para WAIT_COND */
    uint8_t wait_param;
    uint8_t loop_depth;
    stx_loop_frame_t loops[STX_MAX_LOOP_DEPTH];
} stx_context_t;

typedef struct stx_vm {
    const stx_hal_t *hal;
    stx_image_t image;
    bool loaded;
    uint8_t state;              /* STX_VMSTATE_* */
    uint8_t last_error;         /* STX_ERR_* */
    stx_context_t ctx[STX_MAX_CONTEXTS];
} stx_vm_t;

void stx_vm_init(stx_vm_t *vm, const stx_hal_t *hal);

/* Valida la imagen y la deja lista. Devuelve STX_ERR_NONE o STX_ERR_BAD_IMAGE.
 * El buffer debe seguir vivo mientras la VM lo use (la VM no copia). */
uint8_t stx_vm_load(stx_vm_t *vm, const uint8_t *image_buf, uint16_t len);

/* Arranca: contextos ON_START en READY, eventos con condición en ARMED.
 * Devuelve false si no hay imagen cargada. */
bool stx_vm_start(stx_vm_t *vm);

/* Detiene todo y apaga actuadores (tone_stop, motors_stop, led_clear). */
void stx_vm_stop(stx_vm_t *vm);

/* Un paso cooperativo del scheduler. Llamar continuamente. */
void stx_vm_tick(stx_vm_t *vm);

/* Ejecuta UNA instrucción suelta (live passthrough). Rechaza opcodes de
 * control. Devuelve STX_ERR_NONE o el error. */
uint8_t stx_vm_exec_one(stx_vm_t *vm, const uint8_t *instr, uint8_t len);

#endif /* STX_VM_H */
