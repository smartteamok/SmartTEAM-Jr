/*
 * stx_proto.h — Protocolo BLE de SmartTEAM sobre Nordic UART Service.
 *
 * ★ FUENTE DE VERDAD del protocolo (junto con stx_isa.h para el bytecode).
 *   El editor JS consume estas constantes vía Program/STXConstants.js, generado
 *   por firmware/tools/gen_js_constants.py. Mismas convenciones que stx_isa.h.
 *
 * Transporte: Nordic UART Service
 *   servicio 6E400001-B5A3-F393-E0A9-E50E24DCCA9E
 *   RX (central escribe)  6E400002-...  write / write-without-response
 *   TX (firmware notifica) 6E400003-... notify
 *
 * Todos los paquetes de aplicación miden ≤ 20 bytes (ATT MTU 23 por defecto).
 * Multi-byte little-endian. Primer byte = comando; la respuesta del firmware
 * usa (comando | 0x80).
 *
 * El transporte UART es un stream de bytes (MicroBitUARTService no conserva
 * los límites de cada write BLE), así que cada mensaje es auto-delimitado: los
 * comandos tienen longitud fija conocida por su primer byte, salvo XFER_CHUNK
 * y LIVE_EXEC que llevan longitud explícita/derivable.
 *
 * Transferencia de imagen (stop-and-wait, ACK por chunk, reintento x3 en el
 * editor con timeout de 500 ms; el firmware aborta la sesión a los 5 s sin
 * datos). flags.bit0 = VOLATILE: la imagen queda en RAM y NO se persiste en
 * flash (modo vivo del editor — cero desgaste de flash):
 *   → XFER_BEGIN  [0x01][imageLen u16][crc32 u32][flags u8]          (8 B)
 *   ← 0x81        [status]
 *   → XFER_CHUNK  [0x02][seq u8][len u8][data len B]  offset = seq*16 (≤19 B)
 *   ← 0x82        [seq][status]
 *   → XFER_END    [0x03]
 *   ← 0x83        [status]      (0 = CRC ok + cargada; persistida si no volátil)
 *
 * Control:
 *   → RUN         [0x10]                        ← 0x90 [status]
 *   → STOP        [0x11]                        ← 0x91 [status]
 *   → GET_STATUS  [0x12]                        ← 0x92 [vmState][bcVersion]
 *                     [fwMajor][fwMinor][generation u32][imageLen u16]
 *                     [lastError][protoVersion][boardId]              (14 B)
 *   → ERASE       [0x13]                        ← 0x93 [status]
 *   → GET_SENSORS [0x14]                        ← 0x94 [luz u8][sonido u8]
 *                     [botones u8: bit0=A bit1=B][temp i8]
 *
 * Live passthrough (tap sobre un stack en el editor):
 *   → LIVE_EXEC   [0x20][instrucción STX completa: opcode + operandos]
 *                 (la longitud se deriva del opcode con stx_instr_len)
 *   ← 0xA0        [status]
 *   La instrucción se ejecuta inmediatamente con el mismo dispatcher de la VM.
 *   Opcodes de control (WAIT/LOOP/HALT/JMP/MARK) rechazados con STATUS_REJECTED.
 *
 * Notificaciones push (firmware → editor, sin solicitud; primer byte ≥ 0xF0):
 *   ← NOTIF_MARK  [0xF0][index u8]   bloque en ejecución (OP_MARK). Rate-limit
 *                 STX_NOTIF_MIN_INTERVAL_MS; solo se envía el más reciente.
 *   ← NOTIF_DONE  [0xF1][reason u8]  programa terminó solo (0 = fin natural).
 *                 Programas con eventos armados (hats) nunca emiten DONE.
 *   ← NOTIF_FAULT [0xF2][err u8]     la VM se detuvo por error (STX_ERR_*).
 *   DONE/FAULT nunca se pierden; los MARK intermedios pueden colapsarse.
 *   No se emiten notificaciones durante una transferencia en curso.
 */
#ifndef STX_PROTO_H
#define STX_PROTO_H

#ifdef __cplusplus
extern "C" {
#endif

/* ---- Versión de protocolo / firmware ---- */
#define STX_PROTO_VERSION 2
#define STX_FW_MAJOR 0
#define STX_FW_MINOR 2

/* ---- Identidad de placa (GET_STATUS.boardId) ---- */
#define STX_BOARD_BASIC 0             // micro:bit sola
#define STX_BOARD_TINYBIT 1           // Yahboom Tiny:bit (motores I2C)

/* ---- Comandos (central → firmware); respuesta = comando | 0x80 ---- */
#define STX_CMD_XFER_BEGIN 0x01       // [len u16][crc32 u32][flags u8]
#define STX_CMD_XFER_CHUNK 0x02       // [seq u8][data ≤16B]
#define STX_CMD_XFER_END 0x03         // sin payload
#define STX_CMD_RUN 0x10              // sin payload
#define STX_CMD_STOP 0x11             // sin payload
#define STX_CMD_GET_STATUS 0x12       // sin payload
#define STX_CMD_ERASE 0x13            // sin payload
#define STX_CMD_GET_SENSORS 0x14      // sin payload
#define STX_CMD_LIVE_EXEC 0x20        // [instrucción STX cruda]

#define STX_RESP_FLAG 0x80            // respuesta = comando | STX_RESP_FLAG

/* ---- Flags de XFER_BEGIN ---- */
#define STX_XFER_FLAG_VOLATILE 0x01   // no persistir: la imagen vive en RAM (modo vivo)

/* ---- Notificaciones push (firmware → editor, primer byte ≥ 0xF0) ---- */
#define STX_NOTIF_MARK 0xF0           // [index u8] bloque en ejecución
#define STX_NOTIF_DONE 0xF1           // [reason u8] programa terminó (0 = fin natural)
#define STX_NOTIF_FAULT 0xF2          // [err u8] la VM se detuvo por error (STX_ERR_*)
#define STX_NOTIF_MIN_INTERVAL_MS 60  // intervalo mínimo entre NOTIF_MARK enviados

/* ---- Códigos de estado en respuestas ---- */
#define STX_STATUS_OK 0x00
#define STX_STATUS_TOO_LARGE 0x01     // imageLen > STX_MAX_IMAGE_SIZE
#define STX_STATUS_BUSY 0x02          // transferencia u operación en curso
#define STX_STATUS_BAD_CRC 0x03       // CRC32 no coincide en XFER_END
#define STX_STATUS_BAD_LENGTH 0x04    // faltan/sobran bytes al terminar
#define STX_STATUS_FLASH_ERROR 0x05   // error al grabar en flash
#define STX_STATUS_BAD_SEQ 0x06       // chunk fuera de orden — reenviar
#define STX_STATUS_NO_PROGRAM 0x07    // RUN sin imagen válida cargada
#define STX_STATUS_REJECTED 0x08      // comando/instrucción no permitida (ej. WAIT en live)
#define STX_STATUS_NO_SESSION 0x09    // chunk/end sin XFER_BEGIN previo
#define STX_STATUS_BAD_IMAGE 0x0A     // la imagen no pasa la validación de la VM (versión/formato)

/* Estados de la VM (GET_STATUS.vmState): ver STX_VMSTATE_* en stx_isa.h */

/* ---- Parámetros de transferencia ---- */
#define STX_CHUNK_DATA_SIZE 16        // bytes de datos por XFER_CHUNK
#define STX_XFER_TIMEOUT_MS 5000      // el firmware aborta la sesión sin datos
#define STX_PKT_MAX 20                // tamaño máximo de paquete de aplicación


#ifdef __cplusplus
}
#endif

#endif /* STX_PROTO_H */
