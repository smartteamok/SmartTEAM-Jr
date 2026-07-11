/*
 * test_proto.c — Tests del protocolo BLE (stx_proto_engine) end-to-end en host:
 * transferencia completa, reintentos, RUN/STOP/GET_STATUS/LIVE_EXEC.
 */
#include <stdio.h>
#include <string.h>
#include "../../source/proto/stx_proto_engine.h"
#include "fake_hal.h"
#include "fake_flash.h"
#include "test_util.h"

static int failures = 0;
static int checks = 0;

#define CHECK(cond) do { \
    checks++; \
    if (!(cond)) { \
        failures++; \
        printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); \
    } \
} while (0)

/* captura de respuestas TX */
static uint8_t last_resp[20];
static uint8_t last_resp_len = 0;
static int resp_count = 0;

static void capture_send(const uint8_t *data, uint8_t len) {
    memcpy(last_resp, data, len);
    last_resp_len = len;
    resp_count++;
}

static uint32_t proto_now(void) {
    return fake_now;
}

static stx_vm_t vm;
static stx_proto_engine_t pe;

static void vm_notify_bridge(uint8_t evt, uint8_t arg) {
    stx_proto_notify(&pe, evt, arg);
}

static void setup(void) {
    fake_reset();
    fake_flash_reset();
    resp_count = 0;
    last_resp_len = 0;
    stx_vm_init(&vm, &fake_hal);
    stx_proto_init(&pe, &vm, &fake_flash_ops, capture_send, proto_now);
    vm.notify = vm_notify_bridge; /* mismo cableado que main.cpp */
}

/* transfiere una imagen completa por el protocolo; devuelve el status final */
static uint8_t transfer_flags(const uint8_t *image, uint16_t len, uint8_t flags) {
    uint32_t crc = stx_crc32(image, len);
    uint8_t begin[8] = {
        STX_CMD_XFER_BEGIN,
        (uint8_t)(len & 0xFF), (uint8_t)(len >> 8),
        (uint8_t)(crc & 0xFF), (uint8_t)((crc >> 8) & 0xFF),
        (uint8_t)((crc >> 16) & 0xFF), (uint8_t)((crc >> 24) & 0xFF),
        flags
    };
    stx_proto_on_packet(&pe, begin, sizeof(begin));
    if (last_resp[1] != STX_STATUS_OK) return last_resp[1];

    uint8_t seq = 0;
    for (uint16_t off = 0; off < len; off += STX_CHUNK_DATA_SIZE) {
        uint8_t chunk[3 + STX_CHUNK_DATA_SIZE];
        uint8_t n = (len - off) < STX_CHUNK_DATA_SIZE ? (len - off) : STX_CHUNK_DATA_SIZE;
        chunk[0] = STX_CMD_XFER_CHUNK;
        chunk[1] = seq++;
        chunk[2] = n;
        memcpy(chunk + 3, image + off, n);
        stx_proto_on_packet(&pe, chunk, 3 + n);
        if (last_resp[2] != STX_STATUS_OK) return last_resp[2];
    }
    uint8_t end[1] = { STX_CMD_XFER_END };
    stx_proto_on_packet(&pe, end, 1);
    return last_resp[1];
}

static uint8_t transfer(const uint8_t *image, uint16_t len) {
    return transfer_flags(image, len, 0);
}

static void test_full_transfer_and_run(void) {
    setup();
    uint8_t image[64];
    const uint8_t code[] = {
        STX_OP_LED_PATTERN, 0x40, 0x81, 0xE8, 0x00,
        STX_OP_HALT
    };
    uint16_t len = tu_build_start_image(image, code, sizeof(code));

    CHECK(transfer(image, len) == STX_STATUS_OK);
    /* quedó grabada en flash */
    CHECK(stx_store_load(&fake_flash_ops, 0, 0) != 0);
    /* y cargada en la VM, lista para RUN */
    const uint8_t run[1] = { STX_CMD_RUN };
    stx_proto_on_packet(&pe, run, 1);
    CHECK(last_resp[0] == (STX_CMD_RUN | STX_RESP_FLAG));
    CHECK(last_resp[1] == STX_STATUS_OK);
    stx_vm_tick(&vm);
    CHECK(fake_trace_len == 1);
    CHECK(fake_trace[0].type == T_LED_PATTERN);

    /* STOP apaga */
    const uint8_t stop[1] = { STX_CMD_STOP };
    stx_proto_on_packet(&pe, stop, 1);
    CHECK(last_resp[1] == STX_STATUS_OK);
    CHECK(vm.state == STX_VMSTATE_STOPPED);
}

static void test_run_without_program(void) {
    setup();
    const uint8_t run[1] = { STX_CMD_RUN };
    stx_proto_on_packet(&pe, run, 1);
    CHECK(last_resp[1] == STX_STATUS_NO_PROGRAM);
}

static void test_bad_crc_rejected(void) {
    setup();
    uint8_t image[64];
    const uint8_t code[] = { STX_OP_HALT };
    uint16_t len = tu_build_start_image(image, code, sizeof(code));
    image[len - 1] ^= 0xFF; /* romper el contenido después de calcular el CRC externo */

    /* el CRC de transporte se calcula sobre la imagen corrupta, así que
     * el error lo detecta stx_store/stx_image (imagen inválida) */
    uint8_t status = transfer(image, len);
    CHECK(status != STX_STATUS_OK);
    CHECK(stx_store_load(&fake_flash_ops, 0, 0) == 0);
}

static void test_transport_crc_mismatch(void) {
    setup();
    uint8_t image[64];
    const uint8_t code[] = { STX_OP_HALT };
    uint16_t len = tu_build_start_image(image, code, sizeof(code));

    uint8_t begin[8] = {
        STX_CMD_XFER_BEGIN, (uint8_t)(len & 0xFF), (uint8_t)(len >> 8),
        0xEF, 0xBE, 0xAD, 0xDE, /* CRC de transporte incorrecto */
        0
    };
    stx_proto_on_packet(&pe, begin, sizeof(begin));
    uint8_t chunk[3 + 64];
    uint8_t seq = 0;
    for (uint16_t off = 0; off < len; off += STX_CHUNK_DATA_SIZE) {
        uint8_t n = (len - off) < STX_CHUNK_DATA_SIZE ? (len - off) : STX_CHUNK_DATA_SIZE;
        chunk[0] = STX_CMD_XFER_CHUNK;
        chunk[1] = seq++;
        chunk[2] = n;
        memcpy(chunk + 3, image + off, n);
        stx_proto_on_packet(&pe, chunk, 3 + n);
    }
    const uint8_t end[1] = { STX_CMD_XFER_END };
    stx_proto_on_packet(&pe, end, 1);
    CHECK(last_resp[1] == STX_STATUS_BAD_CRC);
}

static void test_duplicate_chunk_reacked(void) {
    setup();
    uint8_t image[64];
    const uint8_t code[] = { STX_OP_HALT };
    uint16_t len = tu_build_start_image(image, code, sizeof(code));
    uint32_t crc = stx_crc32(image, len);
    uint8_t begin[8] = {
        STX_CMD_XFER_BEGIN, (uint8_t)(len & 0xFF), (uint8_t)(len >> 8),
        (uint8_t)(crc & 0xFF), (uint8_t)((crc >> 8) & 0xFF),
        (uint8_t)((crc >> 16) & 0xFF), (uint8_t)((crc >> 24) & 0xFF),
        0
    };
    stx_proto_on_packet(&pe, begin, sizeof(begin));

    uint8_t chunk[3 + 16];
    chunk[0] = STX_CMD_XFER_CHUNK;
    chunk[1] = 0;
    chunk[2] = 16;
    memcpy(chunk + 3, image, 16);
    stx_proto_on_packet(&pe, chunk, 19);
    CHECK(last_resp[2] == STX_STATUS_OK);

    /* chunk 0 repetido (se perdió el ACK): re-ACK sin duplicar datos */
    stx_proto_on_packet(&pe, chunk, 19);
    CHECK(last_resp[1] == 0 && last_resp[2] == STX_STATUS_OK);

    /* chunk fuera de orden (salta al 5): BAD_SEQ */
    chunk[1] = 5;
    stx_proto_on_packet(&pe, chunk, 19);
    CHECK(last_resp[2] == STX_STATUS_BAD_SEQ);
}

static void test_session_timeout(void) {
    setup();
    uint8_t begin[8] = { STX_CMD_XFER_BEGIN, 32, 0, 0, 0, 0, 0, 0 };
    stx_proto_on_packet(&pe, begin, sizeof(begin));
    CHECK(pe.session_active);
    fake_advance(STX_XFER_TIMEOUT_MS + 100);
    stx_proto_tick(&pe);
    CHECK(!pe.session_active);
}

static void test_too_large_rejected(void) {
    setup();
    uint16_t big = STX_MAX_IMAGE_SIZE + 1;
    uint8_t begin[8] = {
        STX_CMD_XFER_BEGIN, (uint8_t)(big & 0xFF), (uint8_t)(big >> 8), 0, 0, 0, 0, 0
    };
    stx_proto_on_packet(&pe, begin, sizeof(begin));
    CHECK(last_resp[1] == STX_STATUS_TOO_LARGE);
}

static void test_live_exec(void) {
    setup();
    const uint8_t live_rgb[5] = { STX_CMD_LIVE_EXEC, STX_OP_RGB_SET, 255, 0, 128 };
    stx_proto_on_packet(&pe, live_rgb, sizeof(live_rgb));
    CHECK(last_resp[0] == (STX_CMD_LIVE_EXEC | STX_RESP_FLAG));
    CHECK(last_resp[1] == STX_STATUS_OK);
    CHECK(fake_trace_len == 1 && fake_trace[0].type == T_RGB);

    const uint8_t live_wait[4] = { STX_CMD_LIVE_EXEC, STX_OP_WAIT_MS, 100, 0 };
    stx_proto_on_packet(&pe, live_wait, sizeof(live_wait));
    CHECK(last_resp[1] == STX_STATUS_REJECTED);
}

static void test_get_status(void) {
    setup();
    uint8_t image[64];
    const uint8_t code[] = { STX_OP_HALT };
    uint16_t len = tu_build_start_image(image, code, sizeof(code));
    transfer(image, len);

    const uint8_t gs[1] = { STX_CMD_GET_STATUS };
    stx_proto_on_packet(&pe, gs, 1);
    CHECK(last_resp_len == 14);
    CHECK(last_resp[0] == (STX_CMD_GET_STATUS | STX_RESP_FLAG));
    CHECK(last_resp[1] == STX_VMSTATE_STOPPED);
    CHECK(last_resp[2] == STX_BC_VERSION);
    uint32_t gen = (uint32_t)last_resp[5] | ((uint32_t)last_resp[6] << 8) |
                   ((uint32_t)last_resp[7] << 16) | ((uint32_t)last_resp[8] << 24);
    CHECK(gen == 1);
    uint16_t stored_len = last_resp[9] | (last_resp[10] << 8);
    CHECK(stored_len == len);
}

static void test_erase(void) {
    setup();
    uint8_t image[64];
    const uint8_t code[] = { STX_OP_HALT };
    uint16_t len = tu_build_start_image(image, code, sizeof(code));
    transfer(image, len);
    CHECK(stx_store_load(&fake_flash_ops, 0, 0) != 0);

    const uint8_t erase[1] = { STX_CMD_ERASE };
    stx_proto_on_packet(&pe, erase, 1);
    CHECK(last_resp[1] == STX_STATUS_OK);
    CHECK(stx_store_load(&fake_flash_ops, 0, 0) == 0);
    const uint8_t run[1] = { STX_CMD_RUN };
    stx_proto_on_packet(&pe, run, 1);
    CHECK(last_resp[1] == STX_STATUS_NO_PROGRAM);
}

static void test_stream_reassembly(void) {
    /* la misma transferencia, pero alimentada byte a byte por on_bytes
     * (simula que el UART service fragmenta arbitrariamente) */
    setup();
    uint8_t image[64];
    const uint8_t code[] = { STX_OP_LED_CLEAR, STX_OP_HALT };
    uint16_t len = tu_build_start_image(image, code, sizeof(code));
    uint32_t crc = stx_crc32(image, len);

    uint8_t stream[256];
    uint16_t n = 0;
    stream[n++] = STX_CMD_XFER_BEGIN;
    stream[n++] = len & 0xFF;
    stream[n++] = (len >> 8) & 0xFF;
    stream[n++] = crc & 0xFF;
    stream[n++] = (crc >> 8) & 0xFF;
    stream[n++] = (crc >> 16) & 0xFF;
    stream[n++] = (crc >> 24) & 0xFF;
    stream[n++] = 0; /* flags */
    uint8_t seq = 0;
    for (uint16_t off = 0; off < len; off += STX_CHUNK_DATA_SIZE) {
        uint8_t c = (len - off) < STX_CHUNK_DATA_SIZE ? (len - off) : STX_CHUNK_DATA_SIZE;
        stream[n++] = STX_CMD_XFER_CHUNK;
        stream[n++] = seq++;
        stream[n++] = c;
        memcpy(stream + n, image + off, c);
        n += c;
    }
    stream[n++] = STX_CMD_XFER_END;
    stream[n++] = STX_CMD_RUN;

    for (uint16_t i = 0; i < n; i++) {
        stx_proto_on_bytes(&pe, stream + i, 1); /* de a un byte */
    }
    CHECK(last_resp[0] == (STX_CMD_RUN | STX_RESP_FLAG));
    CHECK(last_resp[1] == STX_STATUS_OK);
    stx_vm_tick(&vm);
    CHECK(fake_trace_len == 1 && fake_trace[0].type == T_LED_CLEAR);
}

static void test_stream_resync_on_garbage(void) {
    setup();
    /* basura + un comando válido: el framing debe re-sincronizar */
    const uint8_t garbage_then_status[4] = { 0x77, 0x99, 0xFE, STX_CMD_GET_STATUS };
    stx_proto_on_bytes(&pe, garbage_then_status, 4);
    CHECK(resp_count >= 1);
    CHECK(last_resp[0] == (STX_CMD_GET_STATUS | STX_RESP_FLAG));
}

/* ---- Protocolo v2: transferencia volátil, notificaciones, GET_STATUS ---- */

static void run_cmd(void) {
    const uint8_t run[1] = { STX_CMD_RUN };
    stx_proto_on_packet(&pe, run, 1);
}

static void test_volatile_transfer_no_flash(void) {
    setup();
    uint8_t image[64];
    const uint8_t code[] = { STX_OP_LED_CLEAR, STX_OP_HALT };
    uint16_t len = tu_build_start_image(image, code, sizeof(code));

    CHECK(transfer_flags(image, len, STX_XFER_FLAG_VOLATILE) == STX_STATUS_OK);
    CHECK(fake_flash_write_count == 0);              /* cero desgaste de flash */
    CHECK(stx_store_load(&fake_flash_ops, 0, 0) == 0); /* nada persistido */

    run_cmd();
    CHECK(last_resp[1] == STX_STATUS_OK);            /* corre desde RAM */
    stx_vm_tick(&vm);
    CHECK(fake_trace_len == 1 && fake_trace[0].type == T_LED_CLEAR);
}

static void test_persistent_transfer_still_writes(void) {
    setup();
    uint8_t image[64];
    const uint8_t code[] = { STX_OP_HALT };
    uint16_t len = tu_build_start_image(image, code, sizeof(code));
    CHECK(transfer(image, len) == STX_STATUS_OK);
    CHECK(fake_flash_write_count > 0);
    CHECK(stx_store_load(&fake_flash_ops, 0, 0) != 0);
}

static void test_begin_v1_short_rejected(void) {
    setup();
    /* BEGIN de 7 bytes (protocolo v1) inyectado como paquete: BAD_LENGTH */
    const uint8_t begin_v1[7] = { STX_CMD_XFER_BEGIN, 32, 0, 0, 0, 0, 0 };
    stx_proto_on_packet(&pe, begin_v1, 7);
    CHECK(last_resp[1] == STX_STATUS_BAD_LENGTH);
    CHECK(!pe.session_active);
}

static void test_bad_bcversion_reports_bad_image(void) {
    setup();
    uint8_t image[64];
    const uint8_t code[] = { STX_OP_HALT };
    uint16_t len = tu_build_start_image(image, code, sizeof(code));
    image[4] = 99; /* bcVersion inválida */
    /* recalcular el CRC de imagen (está sobre eventos+código, no cambia) y
     * transferir con CRC de transporte correcto: el rechazo es de la VM */
    CHECK(transfer_flags(image, len, STX_XFER_FLAG_VOLATILE) == STX_STATUS_BAD_IMAGE);
}

/* Transfiere+corre un programa con MARK y captura las notificaciones */
static void test_mark_notifications_flow(void) {
    setup();
    uint8_t image[96];
    const uint8_t code[] = {
        STX_OP_MARK, 7,
        STX_OP_LED_CLEAR,
        STX_OP_MARK, 8,
        STX_OP_WAIT_MS, 100, 0,
        STX_OP_MARK, 9,
        STX_OP_HALT
    };
    uint16_t len = tu_build_start_image(image, code, sizeof(code));
    CHECK(transfer_flags(image, len, STX_XFER_FLAG_VOLATILE) == STX_STATUS_OK);
    run_cmd();
    resp_count = 0;

    /* tick de VM: ejecuta MARK 7, LED_CLEAR, MARK 8 y queda en WAIT_MS.
     * MARK 8 pisa a MARK 7 (último gana). */
    stx_vm_tick(&vm);
    CHECK(pe.has_pending_mark && pe.pending_mark == 8);

    /* rate-limit: recién arranca (t=0), el MARK espera el intervalo mínimo */
    stx_proto_tick(&pe);
    CHECK(resp_count == 0);
    fake_advance(STX_NOTIF_MIN_INTERVAL_MS);
    stx_proto_tick(&pe);
    CHECK(resp_count == 1);
    CHECK(last_resp[0] == STX_NOTIF_MARK && last_resp[1] == 8);

    /* vence el WAIT_MS: MARK 9 + HALT → DONE. El DONE descarta el MARK
     * pendiente (un mark tardío re-encendería el resaltado en el editor). */
    fake_advance(100);
    stx_vm_tick(&vm);
    stx_proto_tick(&pe);
    CHECK(last_resp[0] == STX_NOTIF_DONE && last_resp[1] == 0);
    CHECK(!pe.has_pending_mark);
    CHECK(vm.state == STX_VMSTATE_STOPPED);
}

static void test_fault_notification(void) {
    setup();
    uint8_t image[64];
    const uint8_t code[] = { STX_OP_LOOP_END }; /* LOOP_END sin loop: fault */
    uint16_t len = tu_build_start_image(image, code, sizeof(code));
    CHECK(transfer_flags(image, len, STX_XFER_FLAG_VOLATILE) == STX_STATUS_OK);
    run_cmd();
    stx_vm_tick(&vm);
    CHECK(vm.state == STX_VMSTATE_STOPPED);
    stx_proto_tick(&pe);
    CHECK(last_resp[0] == STX_NOTIF_FAULT && last_resp[1] == STX_ERR_LOOP_UNDERFLOW);
}

static void test_no_notifications_during_session(void) {
    setup();
    /* dejar un MARK pendiente y abrir una sesión: el flush no debe salir */
    stx_proto_notify(&pe, STX_VM_EVT_MARK, 3);
    uint8_t begin[8] = { STX_CMD_XFER_BEGIN, 32, 0, 0, 0, 0, 0, 0 };
    stx_proto_on_packet(&pe, begin, 8);
    resp_count = 0;
    stx_proto_tick(&pe);
    CHECK(resp_count == 0); /* nada de pushes con la sesión abierta */
    /* además BEGIN descartó los pendientes de la ejecución anterior */
    CHECK(!pe.has_pending_mark && !pe.has_pending_evt);
}

static void test_stop_clears_pending(void) {
    setup();
    stx_proto_notify(&pe, STX_VM_EVT_MARK, 4);
    stx_proto_notify(&pe, STX_VM_EVT_DONE, 0);
    const uint8_t stop[1] = { STX_CMD_STOP };
    stx_proto_on_packet(&pe, stop, 1);
    CHECK(!pe.has_pending_mark && !pe.has_pending_evt);
}

static void test_fault_beats_done(void) {
    setup();
    stx_proto_notify(&pe, STX_VM_EVT_FAULT, STX_ERR_BAD_OPCODE);
    stx_proto_notify(&pe, STX_VM_EVT_DONE, 0); /* no debe pisar al FAULT */
    stx_proto_tick(&pe);
    CHECK(last_resp[0] == STX_NOTIF_FAULT && last_resp[1] == STX_ERR_BAD_OPCODE);
}

static void test_get_status_v2(void) {
    setup();
    pe.board_id = STX_BOARD_TINYBIT;
    const uint8_t gs[1] = { STX_CMD_GET_STATUS };
    stx_proto_on_packet(&pe, gs, 1);
    CHECK(last_resp_len == 14);
    CHECK(last_resp[12] == STX_PROTO_VERSION);
    CHECK(last_resp[13] == STX_BOARD_TINYBIT);
}

int main(void) {
    test_stream_reassembly();
    test_stream_resync_on_garbage();
    test_full_transfer_and_run();
    test_run_without_program();
    test_bad_crc_rejected();
    test_transport_crc_mismatch();
    test_duplicate_chunk_reacked();
    test_session_timeout();
    test_too_large_rejected();
    test_live_exec();
    test_get_status();
    test_erase();
    test_volatile_transfer_no_flash();
    test_persistent_transfer_still_writes();
    test_begin_v1_short_rejected();
    test_bad_bcversion_reports_bad_image();
    test_mark_notifications_flow();
    test_fault_notification();
    test_no_notifications_during_session();
    test_stop_clears_pending();
    test_fault_beats_done();
    test_get_status_v2();
    printf("%d checks, %d failures\n", checks, failures);
    return failures == 0 ? 0 : 1;
}
