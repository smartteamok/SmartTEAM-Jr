/*
 * stx_hal_tinybit.cpp — HAL STX para el robot Yahboom Tiny:bit (micro:bit V2
 * enchufada al auto). Reutiliza matriz/tono/sensores on-board de la micro:bit
 * y agrega lo del kit por I2C y GPIO.
 *
 * Protocolo verificado contra la extensión oficial MakeCode de Yahboom
 * (github.com/YahboomTechnology/Tiny-bitLib, main.ts):
 *   - I2C addr 7-bit 0x01. Registro 0x02 = motores, buffer de 5 bytes
 *     [0x02, Lade, Latr, Rade, Ratr] con PWM 0-255 por canal (adelante/atrás).
 *     Al invertir el sentido, el lib frena 100 ms; acá basta con escribir el
 *     nuevo buffer (el driver conmuta bien a esta escala de tiempo).
 *   - Registro 0x01 = faros RGB, buffer [0x01, r, g, b].
 *   - Ultrasónico: Trig P16, Echo P15; distancia cm = ancho de pulso us / 58.
 *   - Sensores de línea: izquierda P13, derecha P14 (digital).
 *   - Notas: parlante on-board del micro:bit V2 (igual que el HAL básico).
 *
 * Sin encoders: motors_ticks aproxima la distancia por TIEMPO (ver
 * STX_TINYBIT_MS_PER_TICK — calibrar en la placa).
 */
#include "MicroBit.h"
#include "stx_hal_tinybit.h"
#include "../vm/stx_isa.h"

extern MicroBit uBit;

/* ---- Constantes del Tiny:bit ---- */
#define TINYBIT_I2C_ADDR   0x01   /* dirección 7-bit del driver */
#define TINYBIT_REG_RGB    0x01
#define TINYBIT_REG_MOTOR  0x02
/* ms de movimiento por tick del editor (994 ticks ≈ 1 s). CALIBRAR en placa. */
#define STX_TINYBIT_MS_PER_TICK 1
/* refresco máximo del ultrasónico para no bloquear el tick de la VM */
#define TINYBIT_ULTRA_PERIOD_MS 60
#define TINYBIT_ULTRA_TIMEOUT_US 25000  /* ~4 m: más allá, "sin eco" */

static uint32_t tone_deadline = 0;
static bool tone_active = false;
static uint32_t motor_deadline = 0;
static bool motor_running = false;
static uint32_t ultra_last_ms = 0;
static uint8_t ultra_cm = 255;   /* última distancia medida (255 = lejos) */

static uint32_t h_now_ms(void) {
    return (uint32_t)system_timer_current_time();
}

/* ---- On-board (reutilizado de la micro:bit) ---- */

static void h_led_pattern(uint32_t bits) {
    MicroBitImage image(5, 5);
    for (int i = 0; i < 25; i++) {
        image.setPixelValue(i % 5, i / 5, (bits >> i) & 1 ? 255 : 0);
    }
    uBit.display.print(image);
}

static void h_led_clear(void) {
    uBit.display.clear();
}

static void h_led_brightness(uint8_t value) {
    uBit.display.setBrightness(value);
}

static void h_tone(uint8_t midi_note, uint16_t dur_ms) {
    float freq = 440.0f * powf(2.0f, ((float)midi_note - 69.0f) / 12.0f);
    int period_us = (int)(1000000.0f / freq);
    uBit.io.speaker.setAnalogValue(512);
    uBit.io.speaker.setAnalogPeriodUs(period_us);
    tone_deadline = h_now_ms() + dur_ms;
    tone_active = true;
}

static void h_tone_stop(void) {
    uBit.io.speaker.setAnalogValue(0);
    tone_active = false;
}

/* ---- Faros RGB (I2C reg 0x01) ---- */

static void h_rgb(uint8_t r, uint8_t g, uint8_t b) {
    uint8_t buf[4] = { TINYBIT_REG_RGB, r, g, b };
    uBit.i2c.write(TINYBIT_I2C_ADDR << 1, (uint8_t *)buf, 4);
}

/* ---- Motores (I2C reg 0x02) ---- */

static uint8_t scale_speed(int8_t s) {
    int v = s < 0 ? -s : s;
    if (v > 100) v = 100;
    return (uint8_t)(v * 255 / 100);
}

static void motors_write(int8_t l, int8_t r) {
    uint8_t buf[5];
    buf[0] = TINYBIT_REG_MOTOR;
    /* [Lade, Latr, Rade, Ratr]: canal "adelante" si es positivo, "atrás" si no */
    buf[1] = l >= 0 ? scale_speed(l) : 0;
    buf[2] = l < 0 ? scale_speed(l) : 0;
    buf[3] = r >= 0 ? scale_speed(r) : 0;
    buf[4] = r < 0 ? scale_speed(r) : 0;
    uBit.i2c.write(TINYBIT_I2C_ADDR << 1, (uint8_t *)buf, 5);
}

static void h_motors(int8_t l, int8_t r) {
    motor_running = false; /* continuo: sin auto-stop */
    motors_write(l, r);
}

static uint16_t h_motors_ticks(int8_t l, int8_t r, uint16_t ticks) {
    motors_write(l, r);
    uint32_t ms = (uint32_t)ticks * STX_TINYBIT_MS_PER_TICK;
    if (ms > 0xFFFF) ms = 0xFFFF;
    motor_deadline = h_now_ms() + ms;
    motor_running = true;
    return (uint16_t)ms;
}

static void h_motors_stop(void) {
    motor_running = false;
    motors_write(0, 0);
}

/* ---- Ultrasónico (Trig P16 / Echo P15), medido con cache ---- */

static void ultra_measure(void) {
    uBit.io.P16.setDigitalValue(0);
    target_wait_us(2);
    uBit.io.P16.setDigitalValue(1);
    target_wait_us(15);
    uBit.io.P16.setDigitalValue(0);

    /* esperar flanco de subida del eco */
    uint32_t t0 = (uint32_t)system_timer_current_time_us();
    while (uBit.io.P15.getDigitalValue() == 0) {
        if ((uint32_t)system_timer_current_time_us() - t0 > TINYBIT_ULTRA_TIMEOUT_US) {
            ultra_cm = 255;
            return;
        }
    }
    uint32_t rise = (uint32_t)system_timer_current_time_us();
    while (uBit.io.P15.getDigitalValue() == 1) {
        if ((uint32_t)system_timer_current_time_us() - rise > TINYBIT_ULTRA_TIMEOUT_US) {
            ultra_cm = 255;
            return;
        }
    }
    uint32_t width = (uint32_t)system_timer_current_time_us() - rise;
    uint32_t cm = width / 58;
    ultra_cm = cm > 255 ? 255 : (uint8_t)cm;
}

/* ---- Condiciones ---- */

static bool h_read_cond(uint8_t cond, uint8_t param) {
    switch (cond) {
        case STX_COND_DARK:
            return uBit.display.readLightLevel() < param;
        case STX_COND_BRIGHT:
            return uBit.display.readLightLevel() > param;
        case STX_COND_LOUD:
            return uBit.audio.levelSPL->getValue() > param;
        case STX_COND_BTN_A:
            return uBit.buttonA.isPressed();
        case STX_COND_BTN_B:
            return uBit.buttonB.isPressed();
        case STX_COND_OBSTACLE:
            return ultra_cm < param;   /* distancia (cm) usa el valor cacheado */
        case STX_COND_LINE:
            /* línea detectada en cualquiera de los dos sensores (nivel bajo) */
            return uBit.io.P13.getDigitalValue() == 0 ||
                   uBit.io.P14.getDigitalValue() == 0;
        default:
            return false;
    }
}

void stx_hal_tinybit_update(void) {
    uint32_t now = h_now_ms();
    if (tone_active && (int32_t)(now - tone_deadline) >= 0) {
        h_tone_stop();
    }
    if (motor_running && (int32_t)(now - motor_deadline) >= 0) {
        h_motors_stop();
    }
    if ((uint32_t)(now - ultra_last_ms) >= TINYBIT_ULTRA_PERIOD_MS) {
        ultra_last_ms = now;
        ultra_measure();
    }
}

const stx_hal_t stx_hal_tinybit = {
    h_now_ms,
    h_led_pattern,
    h_led_clear,
    h_led_brightness,
    h_rgb,
    h_tone,
    h_tone_stop,
    h_read_cond,
    h_motors,
    h_motors_ticks,
    h_motors_stop
};
