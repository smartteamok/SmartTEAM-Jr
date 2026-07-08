#include "stx_image.h"

uint32_t stx_crc32(const uint8_t *data, uint32_t len) {
    uint32_t crc = 0xFFFFFFFFu;
    for (uint32_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (int k = 0; k < 8; k++) {
            crc = (crc & 1u) ? (0xEDB88320u ^ (crc >> 1)) : (crc >> 1);
        }
    }
    return crc ^ 0xFFFFFFFFu;
}

static uint16_t rd_u16(const uint8_t *p) {
    return (uint16_t)(p[0] | (p[1] << 8));
}

static uint32_t rd_u32(const uint8_t *p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
           ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

uint8_t stx_image_parse(const uint8_t *buf, uint16_t len, stx_image_t *out) {
    if (buf == 0 || out == 0 || len < STX_HEADER_SIZE + STX_EVENT_ENTRY_SIZE) {
        return STX_ERR_BAD_IMAGE;
    }
    if (buf[0] != STX_MAGIC_0 || buf[1] != STX_MAGIC_1 ||
        buf[2] != STX_MAGIC_2 || buf[3] != STX_MAGIC_3) {
        return STX_ERR_BAD_IMAGE;
    }
    if (buf[4] != STX_BC_VERSION) {
        return STX_ERR_BAD_IMAGE;
    }
    uint8_t event_count = buf[5];
    if (event_count < 1 || event_count > STX_MAX_EVENTS) {
        return STX_ERR_BAD_IMAGE;
    }
    uint16_t code_len = rd_u16(buf + 6);
    uint32_t expected = (uint32_t)STX_HEADER_SIZE +
                        (uint32_t)event_count * STX_EVENT_ENTRY_SIZE + code_len;
    if (expected != len || len > STX_MAX_IMAGE_SIZE) {
        return STX_ERR_BAD_IMAGE;
    }
    uint32_t crc = rd_u32(buf + 8);
    if (crc != stx_crc32(buf + STX_HEADER_SIZE, len - STX_HEADER_SIZE)) {
        return STX_ERR_BAD_IMAGE;
    }
    const uint8_t *events = buf + STX_HEADER_SIZE;
    for (uint8_t i = 0; i < event_count; i++) {
        uint16_t offset = rd_u16(events + i * STX_EVENT_ENTRY_SIZE + 2);
        if (offset >= code_len) {
            return STX_ERR_BAD_IMAGE;
        }
    }
    out->buf = buf;
    out->total_len = len;
    out->event_count = event_count;
    out->code = buf + STX_HEADER_SIZE + event_count * STX_EVENT_ENTRY_SIZE;
    out->code_len = code_len;
    return STX_ERR_NONE;
}

void stx_image_event(const stx_image_t *img, uint8_t i, stx_event_entry_t *out) {
    const uint8_t *p = img->buf + STX_HEADER_SIZE + i * STX_EVENT_ENTRY_SIZE;
    out->type = p[0];
    out->param = p[1];
    out->offset = rd_u16(p + 2);
}
