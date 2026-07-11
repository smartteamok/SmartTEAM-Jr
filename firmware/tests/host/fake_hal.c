#include "fake_hal.h"
#include <string.h>

fake_call_t fake_trace[FAKE_TRACE_MAX];
int fake_trace_len = 0;
uint32_t fake_now = 0;
bool fake_conds[256];

static void record(fake_call_type_t type, uint32_t a, uint32_t b, uint32_t c) {
    if (fake_trace_len < FAKE_TRACE_MAX) {
        fake_trace[fake_trace_len].type = type;
        fake_trace[fake_trace_len].a = a;
        fake_trace[fake_trace_len].b = b;
        fake_trace[fake_trace_len].c = c;
        fake_trace[fake_trace_len].at_ms = fake_now;
        fake_trace_len++;
    }
}

void fake_reset(void) {
    fake_trace_len = 0;
    fake_now = 0;
    memset(fake_conds, 0, sizeof(fake_conds));
}

void fake_advance(uint32_t ms) {
    fake_now += ms;
}

static uint32_t h_now(void) { return fake_now; }
static void h_led_pattern(uint32_t bits) { record(T_LED_PATTERN, bits, 0, 0); }
static void h_led_clear(void) { record(T_LED_CLEAR, 0, 0, 0); }
static void h_led_bright(uint8_t v) { record(T_LED_BRIGHT, v, 0, 0); }
static void h_rgb(uint8_t r, uint8_t g, uint8_t b) { record(T_RGB, r, g, b); }
static void h_tone(uint8_t note, uint16_t ms) { record(T_TONE, note, ms, 0); }
static void h_tone_stop(void) { record(T_TONE_STOP, 0, 0, 0); }
static bool h_read_cond(uint8_t cond, uint8_t param) {
    (void)param;
    return fake_conds[cond];
}
static void h_motors(int8_t l, int8_t r) { record(T_MOTORS, (uint32_t)l, (uint32_t)r, 0); }
/* devuelve los ms de espera: 1 ms por tick, como el HAL Tiny:bit */
static uint16_t h_motors_ticks(int8_t l, int8_t r, uint16_t t) {
    record(T_MOTORS_TICKS, (uint32_t)l, (uint32_t)r, t);
    return t;
}
static void h_motors_stop(void) { record(T_MOTORS_STOP, 0, 0, 0); }

const stx_hal_t fake_hal = {
    h_now, h_led_pattern, h_led_clear, h_led_bright, h_rgb,
    h_tone, h_tone_stop, h_read_cond,
    h_motors, h_motors_ticks, h_motors_stop
};

const stx_hal_t fake_hal_onboard = {
    h_now, h_led_pattern, h_led_clear, h_led_bright, h_rgb,
    h_tone, h_tone_stop, h_read_cond,
    0, 0, 0
};
