"use strict";

/* STXConstants — GENERADO por firmware/tools/gen_js_constants.py.
 * NO editar a mano: cambiar firmware/source/vm/stx_isa.h o
 * firmware/source/proto/stx_proto.h y regenerar. */
var STX = {};

/* ---- stx_isa.h ---- */
STX.MAGIC_0 = 0x53;  // 'S'
STX.MAGIC_1 = 0x54;  // 'T'
STX.MAGIC_2 = 0x58;  // 'X'
STX.MAGIC_3 = 0x31;  // '1'
STX.BC_VERSION = 0x02;  // versión del bytecode (v2: OP_MARK)
STX.HEADER_SIZE = 0x0C;  // bytes de header antes de la tabla de eventos
STX.EVENT_ENTRY_SIZE = 0x04;  // bytes por entrada de la tabla de eventos
STX.MAX_IMAGE_SIZE = 0x800;  // tamaño máximo de la imagen completa (header incluido)
STX.MAX_EVENTS = 0x08;  // entradas máximas en la tabla de eventos
STX.MAX_CONTEXTS = 0x04;  // contextos de ejecución concurrentes en la VM
STX.MAX_LOOP_DEPTH = 0x08;  // profundidad máxima de loops anidados por contexto
STX.EVT_ON_START = 0x00;  // al arrancar el programa (RUN o boot)
STX.EVT_ON_DARK = 0x01;  // luz < param
STX.EVT_ON_LOUD = 0x02;  // nivel de sonido > param (requiere V2)
STX.EVT_ON_BUTTON_A = 0x03;  // botón A presionado
STX.EVT_ON_BUTTON_B = 0x04;  // botón B presionado
STX.OP_NOP = 0x00;  // sin operandos
STX.OP_HALT = 0x01;  // sin operandos — termina el handler
STX.OP_WAIT_MS = 0x02;  // u16 ms — espera no bloqueante
STX.OP_LOOP_N = 0x03;  // u8 n (1-255) — abre loop de n vueltas
STX.OP_LOOP_END = 0x04;  // sin operandos — cierra loop
STX.OP_LOOP_FOREVER = 0x05;  // sin operandos — abre loop infinito
STX.OP_JMP = 0x06;  // i16 rel — RESERVADO v1 (la VM lo rechaza)
STX.OP_WAIT_UNTIL = 0x07;  // u8 cond, u8 param — espera condición
STX.OP_MARK = 0x08;  // u8 index — bloque en ejecución (notificación al editor)
STX.OP_LED_PATTERN = 0x10;  // 4 bytes: 25 bits row-major LSB-first, bit0 = LED(0,0)
STX.OP_LED_CLEAR = 0x11;  // sin operandos
STX.OP_LED_BRIGHT = 0x12;  // u8 brillo 0-255
STX.OP_RGB_SET = 0x18;  // u8 r, u8 g, u8 b (0-255) — color abstracto, mapea el HAL
STX.OP_TONE = 0x20;  // u8 nota MIDI, u16 durMs — NO bloqueante
STX.OP_TONE_STOP = 0x21;  // sin operandos
STX.OP_MOTORS = 0x30;  // i8 spdL, i8 spdR (-100..100) — continuo
STX.OP_MOTORS_TICKS = 0x31;  // i8 spdL, i8 spdR, u16 ticks — bloqueante hasta completar
STX.OP_MOTORS_STOP = 0x32;  // sin operandos
STX.COND_DARK = 0x01;  // luz < param
STX.COND_BRIGHT = 0x02;  // luz > param
STX.COND_LOUD = 0x03;  // sonido > param (requiere V2)
STX.COND_BTN_A = 0x04;  // botón A presionado
STX.COND_BTN_B = 0x05;  // botón B presionado
STX.COND_OBSTACLE = 0x10;  // distancia < param cm (v2)
STX.COND_LINE = 0x11;  // sensor de línea activo (v2)
STX.COND_SOIL_DRY = 0x12;  // humedad < param (v2)
STX.VMSTATE_STOPPED = 0x00;
STX.VMSTATE_RUNNING = 0x01;
STX.VMSTATE_PAUSED = 0x02;  // reservado
STX.ERR_NONE = 0x00;
STX.ERR_BAD_OPCODE = 0x01;  // opcode desconocido o reservado
STX.ERR_PC_RANGE = 0x02;  // PC fuera de la sección de código
STX.ERR_LOOP_OVERFLOW = 0x03;  // más de STX_MAX_LOOP_DEPTH loops anidados
STX.ERR_LOOP_UNDERFLOW = 0x04;  // LOOP_END sin loop abierto
STX.ERR_BAD_IMAGE = 0x05;  // imagen inválida (magic/CRC/longitud)

/* ---- stx_proto.h ---- */
STX.PROTO_VERSION = 0x02;
STX.FW_MAJOR = 0x00;
STX.FW_MINOR = 0x02;
STX.BOARD_BASIC = 0x00;  // micro:bit sola
STX.BOARD_TINYBIT = 0x01;  // Yahboom Tiny:bit (motores I2C)
STX.CMD_XFER_BEGIN = 0x01;  // [len u16][crc32 u32][flags u8]
STX.CMD_XFER_CHUNK = 0x02;  // [seq u8][data ≤16B]
STX.CMD_XFER_END = 0x03;  // sin payload
STX.CMD_RUN = 0x10;  // sin payload
STX.CMD_STOP = 0x11;  // sin payload
STX.CMD_GET_STATUS = 0x12;  // sin payload
STX.CMD_ERASE = 0x13;  // sin payload
STX.CMD_GET_SENSORS = 0x14;  // sin payload
STX.CMD_LIVE_EXEC = 0x20;  // [instrucción STX cruda]
STX.RESP_FLAG = 0x80;  // respuesta = comando | STX_RESP_FLAG
STX.XFER_FLAG_VOLATILE = 0x01;  // no persistir: la imagen vive en RAM (modo vivo)
STX.NOTIF_MARK = 0xF0;  // [index u8] bloque en ejecución
STX.NOTIF_DONE = 0xF1;  // [reason u8] programa terminó (0 = fin natural)
STX.NOTIF_FAULT = 0xF2;  // [err u8] la VM se detuvo por error (STX_ERR_*)
STX.NOTIF_MIN_INTERVAL_MS = 0x3C;  // intervalo mínimo entre NOTIF_MARK enviados
STX.STATUS_OK = 0x00;
STX.STATUS_TOO_LARGE = 0x01;  // imageLen > STX_MAX_IMAGE_SIZE
STX.STATUS_BUSY = 0x02;  // transferencia u operación en curso
STX.STATUS_BAD_CRC = 0x03;  // CRC32 no coincide en XFER_END
STX.STATUS_BAD_LENGTH = 0x04;  // faltan/sobran bytes al terminar
STX.STATUS_FLASH_ERROR = 0x05;  // error al grabar en flash
STX.STATUS_BAD_SEQ = 0x06;  // chunk fuera de orden — reenviar
STX.STATUS_NO_PROGRAM = 0x07;  // RUN sin imagen válida cargada
STX.STATUS_REJECTED = 0x08;  // comando/instrucción no permitida (ej. WAIT en live)
STX.STATUS_NO_SESSION = 0x09;  // chunk/end sin XFER_BEGIN previo
STX.STATUS_BAD_IMAGE = 0x0A;  // la imagen no pasa la validación de la VM (versión/formato)
STX.CHUNK_DATA_SIZE = 0x10;  // bytes de datos por XFER_CHUNK
STX.XFER_TIMEOUT_MS = 0x1388;  // el firmware aborta la sesión sin datos
STX.PKT_MAX = 0x14;  // tamaño máximo de paquete de aplicación

if (typeof module !== "undefined" && module.exports) {
  module.exports = STX;
}
