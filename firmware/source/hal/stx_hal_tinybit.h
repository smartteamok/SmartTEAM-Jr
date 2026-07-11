/*
 * stx_hal_tinybit.h — HAL para el robot Yahboom Tiny:bit (micro:bit V2 + auto).
 * Superset del HAL on-board: agrega motores y faros RGB por I2C, ultrasónico
 * y sensores de línea. Ver stx_hal_tinybit.cpp para el protocolo.
 */
#ifndef STX_HAL_TINYBIT_H
#define STX_HAL_TINYBIT_H

#include "stx_hal.h"

extern const stx_hal_t stx_hal_tinybit;

/* Llamar desde el loop principal: corta tono/motores vencidos y refresca la
 * lectura cacheada del ultrasónico. */
void stx_hal_tinybit_update(void);

#endif /* STX_HAL_TINYBIT_H */
