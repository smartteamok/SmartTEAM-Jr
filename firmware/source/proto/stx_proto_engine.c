#include "stx_proto_engine.h"
#include "../vm/stx_image.h"
#include <string.h>

static uint16_t rd_u16(const uint8_t *p) {
    return (uint16_t)(p[0] | (p[1] << 8));
}

static uint32_t rd_u32(const uint8_t *p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
           ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

void stx_proto_init(stx_proto_engine_t *pe, stx_vm_t *vm,
                    const stx_flash_ops_t *flash,
                    void (*send)(const uint8_t *, uint8_t),
                    uint32_t (*now_ms)(void)) {
    memset(pe, 0, sizeof(*pe));
    pe->vm = vm;
    pe->flash = flash;
    pe->send = send;
    pe->now_ms = now_ms;
}

static void reply1(stx_proto_engine_t *pe, uint8_t cmd, uint8_t status) {
    uint8_t out[2] = { (uint8_t)(cmd | STX_RESP_FLAG), status };
    pe->send(out, 2);
}

static void reply_chunk(stx_proto_engine_t *pe, uint8_t seq, uint8_t status) {
    uint8_t out[3] = { STX_CMD_XFER_CHUNK | STX_RESP_FLAG, seq, status };
    pe->send(out, 3);
}

static void abort_session(stx_proto_engine_t *pe) {
    pe->session_active = false;
    pe->received = 0;
    pe->next_seq = 0;
}

static void handle_begin(stx_proto_engine_t *pe, const uint8_t *d, uint8_t len) {
    if (len < 7) {
        reply1(pe, STX_CMD_XFER_BEGIN, STX_STATUS_BAD_LENGTH);
        return;
    }
    uint16_t image_len = rd_u16(d + 1);
    if (image_len == 0 || image_len > STX_MAX_IMAGE_SIZE) {
        reply1(pe, STX_CMD_XFER_BEGIN, STX_STATUS_TOO_LARGE);
        return;
    }
    /* Transferir implica detener el programa en curso */
    stx_vm_stop(pe->vm);
    pe->session_active = true;
    pe->expected_len = image_len;
    pe->expected_crc = rd_u32(d + 3);
    pe->received = 0;
    pe->next_seq = 0;
    pe->last_rx_ms = pe->now_ms();
    reply1(pe, STX_CMD_XFER_BEGIN, STX_STATUS_OK);
}

static void handle_chunk(stx_proto_engine_t *pe, const uint8_t *d, uint8_t len) {
    if (!pe->session_active) {
        reply_chunk(pe, len >= 2 ? d[1] : 0, STX_STATUS_NO_SESSION);
        return;
    }
    if (len < 3) {
        reply_chunk(pe, 0, STX_STATUS_BAD_LENGTH);
        return;
    }
    uint8_t seq = d[1];
    uint8_t data_len = len - 2;
    pe->last_rx_ms = pe->now_ms();
    if (seq != pe->next_seq) {
        /* chunk repetido (ACK perdido): re-ACK; adelantado: pedir reenvío */
        if ((uint8_t)(seq + 1) == pe->next_seq) {
            reply_chunk(pe, seq, STX_STATUS_OK);
        } else {
            reply_chunk(pe, seq, STX_STATUS_BAD_SEQ);
        }
        return;
    }
    if (pe->received + data_len > pe->expected_len) {
        abort_session(pe);
        reply_chunk(pe, seq, STX_STATUS_BAD_LENGTH);
        return;
    }
    memcpy(pe->buffer + pe->received, d + 2, data_len);
    pe->received += data_len;
    pe->next_seq++;
    reply_chunk(pe, seq, STX_STATUS_OK);
}

static void handle_end(stx_proto_engine_t *pe) {
    if (!pe->session_active) {
        reply1(pe, STX_CMD_XFER_END, STX_STATUS_NO_SESSION);
        return;
    }
    pe->session_active = false;
    if (pe->received != pe->expected_len) {
        reply1(pe, STX_CMD_XFER_END, STX_STATUS_BAD_LENGTH);
        return;
    }
    if (stx_crc32(pe->buffer, pe->received) != pe->expected_crc) {
        reply1(pe, STX_CMD_XFER_END, STX_STATUS_BAD_CRC);
        return;
    }
    uint8_t status = stx_store_save(pe->flash, pe->buffer, pe->received);
    if (status != STX_STATUS_OK) {
        reply1(pe, STX_CMD_XFER_END, status);
        return;
    }
    /* cargar la imagen recién grabada (puntero estable a flash) */
    uint16_t len = 0;
    const uint8_t *image = stx_store_load(pe->flash, &len, 0);
    if (image == 0 || stx_vm_load(pe->vm, image, len) != STX_ERR_NONE) {
        reply1(pe, STX_CMD_XFER_END, STX_STATUS_FLASH_ERROR);
        return;
    }
    reply1(pe, STX_CMD_XFER_END, STX_STATUS_OK);
}

static void handle_get_status(stx_proto_engine_t *pe) {
    uint16_t len = 0;
    uint32_t gen = 0;
    stx_store_load(pe->flash, &len, &gen);
    uint8_t out[12];
    out[0] = STX_CMD_GET_STATUS | STX_RESP_FLAG;
    out[1] = pe->vm->state;
    out[2] = STX_BC_VERSION;
    out[3] = STX_FW_MAJOR;
    out[4] = STX_FW_MINOR;
    out[5] = gen & 0xFF;
    out[6] = (gen >> 8) & 0xFF;
    out[7] = (gen >> 16) & 0xFF;
    out[8] = (gen >> 24) & 0xFF;
    out[9] = len & 0xFF;
    out[10] = (len >> 8) & 0xFF;
    out[11] = pe->vm->last_error;
    pe->send(out, 12);
}

void stx_proto_on_packet(stx_proto_engine_t *pe, const uint8_t *data, uint8_t len) {
    if (len == 0) {
        return;
    }
    switch (data[0]) {
        case STX_CMD_XFER_BEGIN:
            handle_begin(pe, data, len);
            break;
        case STX_CMD_XFER_CHUNK:
            handle_chunk(pe, data, len);
            break;
        case STX_CMD_XFER_END:
            handle_end(pe);
            break;
        case STX_CMD_RUN:
            if (pe->session_active) {
                reply1(pe, STX_CMD_RUN, STX_STATUS_BUSY);
            } else if (stx_vm_start(pe->vm)) {
                reply1(pe, STX_CMD_RUN, STX_STATUS_OK);
            } else {
                reply1(pe, STX_CMD_RUN, STX_STATUS_NO_PROGRAM);
            }
            break;
        case STX_CMD_STOP:
            stx_vm_stop(pe->vm);
            reply1(pe, STX_CMD_STOP, STX_STATUS_OK);
            break;
        case STX_CMD_GET_STATUS:
            handle_get_status(pe);
            break;
        case STX_CMD_ERASE:
            stx_vm_stop(pe->vm);
            pe->vm->loaded = false;
            reply1(pe, STX_CMD_ERASE, stx_store_erase_all(pe->flash));
            break;
        case STX_CMD_LIVE_EXEC: {
            uint8_t err = stx_vm_exec_one(pe->vm, data + 1, len - 1);
            reply1(pe, STX_CMD_LIVE_EXEC,
                   err == STX_ERR_NONE ? STX_STATUS_OK : STX_STATUS_REJECTED);
            break;
        }
        default:
            reply1(pe, data[0], STX_STATUS_REJECTED);
            break;
    }
}

void stx_proto_tick(stx_proto_engine_t *pe) {
    if (pe->session_active &&
        (uint32_t)(pe->now_ms() - pe->last_rx_ms) > STX_XFER_TIMEOUT_MS) {
        abort_session(pe);
    }
}
