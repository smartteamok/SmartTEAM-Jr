/* Helpers compartidos por los tests de host: builder de imágenes STX1 */
#ifndef TEST_UTIL_H
#define TEST_UTIL_H

#include <stdint.h>
#include <string.h>
#include "../../source/vm/stx_image.h"

typedef struct {
    uint8_t type, param;
    uint16_t offset;
} tu_ev_t;

static uint16_t tu_build_image(uint8_t *buf, const tu_ev_t *events, uint8_t nev,
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

static uint16_t tu_build_start_image(uint8_t *buf, const uint8_t *code, uint16_t code_len) {
    tu_ev_t ev = { STX_EVT_ON_START, 0, 0 };
    return tu_build_image(buf, &ev, 1, code, code_len);
}

#endif /* TEST_UTIL_H */
