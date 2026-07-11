/*
 * fake_hal.h — HAL simulado para tests de host: registra una traza de llamadas
 * y expone un reloj virtual y condiciones controlables desde el test.
 */
#ifndef FAKE_HAL_H
#define FAKE_HAL_H

#include <stdint.h>
#include <stdbool.h>
#include "../../source/hal/stx_hal.h"

#define FAKE_TRACE_MAX 128

typedef enum {
    T_LED_PATTERN, T_LED_CLEAR, T_LED_BRIGHT, T_RGB,
    T_TONE, T_TONE_STOP, T_MOTORS, T_MOTORS_TICKS, T_MOTORS_STOP
} fake_call_type_t;

typedef struct {
    fake_call_type_t type;
    uint32_t a, b, c;      /* argumentos (patrón / r,g,b / nota,ms / ...) */
    uint32_t at_ms;        /* reloj virtual al momento de la llamada */
} fake_call_t;

extern fake_call_t fake_trace[FAKE_TRACE_MAX];
extern int fake_trace_len;
extern uint32_t fake_now;
extern bool fake_conds[256];   /* fake_conds[STX_COND_X] controlado por el test */

/* HAL completo (con motores) y HAL on-board (motores NULL) */
extern const stx_hal_t fake_hal;
extern const stx_hal_t fake_hal_onboard;

void fake_reset(void);
void fake_advance(uint32_t ms);   /* avanza el reloj virtual */

#endif /* FAKE_HAL_H */
