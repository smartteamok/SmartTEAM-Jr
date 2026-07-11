/*
 * stx_hal_codal.h — HAL real sobre CODAL (micro:bit V2, solo on-board v1).
 */
#ifndef STX_HAL_CODAL_H
#define STX_HAL_CODAL_H

#include "stx_hal.h"

/* HAL on-board: display 5x5, buzzer, botones, luz, micrófono. Motores NULL. */
extern const stx_hal_t stx_hal_codal;

/* Llamar desde el loop principal: corta el tono cuando vence su duración. */
void stx_hal_codal_update(void);

#endif /* STX_HAL_CODAL_H */
