/*
 * stx_hal_codal.cpp — Implementación del HAL STX sobre CODAL (micro:bit V2).
 * On-board v1: matriz 5x5, buzzer (PWM en el speaker), botones A/B, sensor de
 * luz de la matriz y micrófono (V2). Motores: NULL (kit v2).
 */
#include "MicroBit.h"
#include "stx_hal_codal.h"
#include "../vm/stx_isa.h"

extern MicroBit uBit;

static uint32_t tone_deadline = 0;
static bool tone_active = false;

static uint32_t h_now_ms(void) {
    return (uint32_t)system_timer_current_time();
}

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

static void h_rgb(uint8_t r, uint8_t g, uint8_t b) {
    /* micro:bit sola no tiene LED RGB: mapear a la matriz completa con brillo
     * proporcional a la componente máxima. El kit v2 reemplaza esto por un
     * LED RGB real sin tocar la VM. */
    uint8_t level = r > g ? (r > b ? r : b) : (g > b ? g : b);
    if (level == 0) {
        uBit.display.clear();
        return;
    }
    uBit.display.setBrightness(level);
    MicroBitImage image(5, 5);
    for (int i = 0; i < 25; i++) {
        image.setPixelValue(i % 5, i / 5, 255);
    }
    uBit.display.print(image);
}

static void h_tone(uint8_t midi_note, uint16_t dur_ms) {
    /* nota MIDI -> Hz; PWM en el pin del speaker con auto-stop */
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

void stx_hal_codal_update(void) {
    if (tone_active && (int32_t)(h_now_ms() - tone_deadline) >= 0) {
        h_tone_stop();
    }
}

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
        default:
            return false;
    }
}

extern "C" {
const stx_hal_t stx_hal_codal = {
    h_now_ms,
    h_led_pattern,
    h_led_clear,
    h_led_brightness,
    h_rgb,
    h_tone,
    h_tone_stop,
    h_read_cond,
    0, /* motors — kit v2 */
    0, /* motors_ticks */
    0  /* motors_stop */
};
}
