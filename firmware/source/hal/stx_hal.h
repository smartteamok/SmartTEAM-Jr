/*
 * stx_hal.h — Interfaz de hardware de la VM STX. C portable, sin CODAL.
 *
 * La VM solo habla con el hardware a través de esta struct de punteros a
 * función. En la placa la implementa stx_hal_codal.cpp; en los tests de host,
 * tests/host/fake_hal.c (que registra una traza de llamadas y simula el reloj).
 *
 * Punteros opcionales (pueden ser NULL): motors, motors_ticks, motors_stop
 * (kit v2). Si la VM encuentra un opcode cuyo puntero es NULL, aborta con
 * STX_ERR_BAD_OPCODE — así el firmware on-board v1 rechaza opcodes del kit
 * sin lógica extra.
 */
#ifndef STX_HAL_H
#define STX_HAL_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stdint.h>
#include <stdbool.h>

typedef struct stx_hal {
    /* Tiempo monotónico en ms (en host: reloj virtual del test) */
    uint32_t (*now_ms)(void);

    /* Display 5x5: bits 0-24 row-major LSB-first, bit0 = LED(0,0) */
    void (*led_pattern)(uint32_t bits);
    void (*led_clear)(void);
    void (*led_brightness)(uint8_t value);

    /* Color abstracto (0-255); en micro:bit sola el HAL decide cómo mostrarlo */
    void (*rgb)(uint8_t r, uint8_t g, uint8_t b);

    /* Tono con auto-stop a los dur_ms (NO bloqueante) */
    void (*tone)(uint8_t midi_note, uint16_t dur_ms);
    void (*tone_stop)(void);

    /* Condiciones (STX_COND_*): true si la condición se cumple ahora */
    bool (*read_cond)(uint8_t cond, uint8_t param);

    /* Kit v2 — NULL en firmware on-board v1 */
    void (*motors)(int8_t speed_l, int8_t speed_r);
    void (*motors_ticks)(int8_t speed_l, int8_t speed_r, uint16_t ticks);
    void (*motors_stop)(void);
} stx_hal_t;


#ifdef __cplusplus
}
#endif

#endif /* STX_HAL_H */
