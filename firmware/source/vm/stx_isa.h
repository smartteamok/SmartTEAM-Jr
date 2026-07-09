/*
 * stx_isa.h — SmartTEAM eXecutable (STX1) instruction set architecture.
 *
 * ★ FUENTE DE VERDAD del bytecode. El editor JS consume estas constantes vía
 *   Program/STXConstants.js, GENERADO por firmware/tools/gen_js_constants.py.
 *   Nunca editar STXConstants.js a mano; cambiar aquí y regenerar.
 *
 * Convenciones del generador (no romper):
 *   - Solo se exportan los #define con prefijo STX_.
 *   - Un #define por línea, valor entero (decimal o 0x hex), comentario opcional
 *     con "//" en la misma línea (se copia al JS).
 *
 * Formato de imagen STX1 (little-endian en todos los campos multi-byte):
 *
 *   Header (12 bytes):
 *     [0..3]  magic "STX1" (0x53 0x54 0x58 0x31)
 *     [4]     bcVersion (= STX_BC_VERSION)
 *     [5]     eventCount (1..STX_MAX_EVENTS)
 *     [6..7]  codeLen u16 — bytes de la sección de código
 *     [8..11] crc32 u32 — CRC-32/IEEE sobre [tabla de eventos + código]
 *
 *   Tabla de eventos (eventCount × 4 bytes):
 *     [0] eventType (STX_EVT_*)
 *     [1] param (umbral para DARK/LOUD; 0 si no aplica)
 *     [2..3] entryOffset u16 — offset del handler, relativo al inicio del código
 *
 *   Código: instrucciones de 1 byte de opcode + operandos de tamaño fijo.
 *   Cada handler DEBE terminar en HALT (o quedar dentro de LOOP_FOREVER).
 *
 * Loops: estructurados con pila en la VM (LOOP_N/LOOP_FOREVER apilan un frame
 * {startPC, count}; LOOP_END decrementa y salta o desapila). Profundidad máx
 * STX_MAX_LOOP_DEPTH. No hay saltos arbitrarios en v1 (JMP reservado).
 *
 * TONE es NO bloqueante (inicia el tono con auto-stop a los durMs); el
 * compilador emite TONE + WAIT_MS para bloques bloqueantes del editor.
 */
#ifndef STX_ISA_H
#define STX_ISA_H

#ifdef __cplusplus
extern "C" {
#endif

/* ---- Versión y límites ---- */
#define STX_MAGIC_0 0x53              // 'S'
#define STX_MAGIC_1 0x54              // 'T'
#define STX_MAGIC_2 0x58              // 'X'
#define STX_MAGIC_3 0x31              // '1'
#define STX_BC_VERSION 1              // versión del bytecode
#define STX_HEADER_SIZE 12            // bytes de header antes de la tabla de eventos
#define STX_EVENT_ENTRY_SIZE 4        // bytes por entrada de la tabla de eventos
#define STX_MAX_IMAGE_SIZE 2048       // tamaño máximo de la imagen completa (header incluido)
#define STX_MAX_EVENTS 8              // entradas máximas en la tabla de eventos
#define STX_MAX_CONTEXTS 4            // contextos de ejecución concurrentes en la VM
#define STX_MAX_LOOP_DEPTH 8          // profundidad máxima de loops anidados por contexto

/* ---- Eventos (tabla de entry points) ---- */
#define STX_EVT_ON_START 0x00         // al arrancar el programa (RUN o boot)
#define STX_EVT_ON_DARK 0x01          // luz < param
#define STX_EVT_ON_LOUD 0x02          // nivel de sonido > param (requiere V2)
#define STX_EVT_ON_BUTTON_A 0x03      // botón A presionado
#define STX_EVT_ON_BUTTON_B 0x04      // botón B presionado
/* 0x10-0x1F reservados kit v2: obstáculo, línea, humedad, ... */

/* ---- Opcodes: control 0x00-0x0F ---- */
#define STX_OP_NOP 0x00               // sin operandos
#define STX_OP_HALT 0x01              // sin operandos — termina el handler
#define STX_OP_WAIT_MS 0x02           // u16 ms — espera no bloqueante
#define STX_OP_LOOP_N 0x03            // u8 n (1-255) — abre loop de n vueltas
#define STX_OP_LOOP_END 0x04          // sin operandos — cierra loop
#define STX_OP_LOOP_FOREVER 0x05      // sin operandos — abre loop infinito
#define STX_OP_JMP 0x06               // i16 rel — RESERVADO v1 (la VM lo rechaza)
#define STX_OP_WAIT_UNTIL 0x07        // u8 cond, u8 param — espera condición

/* ---- Opcodes: on-board v1 0x10-0x2F ---- */
#define STX_OP_LED_PATTERN 0x10       // 4 bytes: 25 bits row-major LSB-first, bit0 = LED(0,0)
#define STX_OP_LED_CLEAR 0x11         // sin operandos
#define STX_OP_LED_BRIGHT 0x12        // u8 brillo 0-255
#define STX_OP_RGB_SET 0x18           // u8 r, u8 g, u8 b (0-255) — color abstracto, mapea el HAL
#define STX_OP_TONE 0x20              // u8 nota MIDI, u16 durMs — NO bloqueante
#define STX_OP_TONE_STOP 0x21         // sin operandos

/* ---- Opcodes: kit SmartTEAM v2 0x30-0x4F (reservados, VM v1 los rechaza) ---- */
#define STX_OP_MOTORS 0x30            // i8 spdL, i8 spdR (-100..100) — continuo
#define STX_OP_MOTORS_TICKS 0x31      // i8 spdL, i8 spdR, u16 ticks — bloqueante hasta completar
#define STX_OP_MOTORS_STOP 0x32       // sin operandos
/* 0x40-0x4F reservados: OLED, servos, ... */

/* ---- Condiciones (WAIT_UNTIL y eventos) ---- */
#define STX_COND_DARK 0x01            // luz < param
#define STX_COND_BRIGHT 0x02          // luz > param
#define STX_COND_LOUD 0x03            // sonido > param (requiere V2)
#define STX_COND_BTN_A 0x04           // botón A presionado
#define STX_COND_BTN_B 0x05           // botón B presionado
/* 0x10+ reservados kit v2 */
#define STX_COND_OBSTACLE 0x10        // distancia < param cm (v2)
#define STX_COND_LINE 0x11            // sensor de línea activo (v2)
#define STX_COND_SOIL_DRY 0x12        // humedad < param (v2)

/* ---- Estados de la VM (GET_STATUS.vmState) ---- */
#define STX_VMSTATE_STOPPED 0x00
#define STX_VMSTATE_RUNNING 0x01
#define STX_VMSTATE_PAUSED 0x02      // reservado

/* ---- Errores de runtime de la VM (GET_STATUS.lastError) ---- */
#define STX_ERR_NONE 0x00
#define STX_ERR_BAD_OPCODE 0x01       // opcode desconocido o reservado
#define STX_ERR_PC_RANGE 0x02         // PC fuera de la sección de código
#define STX_ERR_LOOP_OVERFLOW 0x03    // más de STX_MAX_LOOP_DEPTH loops anidados
#define STX_ERR_LOOP_UNDERFLOW 0x04   // LOOP_END sin loop abierto
#define STX_ERR_BAD_IMAGE 0x05        // imagen inválida (magic/CRC/longitud)


#ifdef __cplusplus
}
#endif

#endif /* STX_ISA_H */
