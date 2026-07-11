# Firmware SmartTEAM para micro:bit V2

Ejecuta programas STX1 (bytecode compilado por el editor FinchBlox/SmartTEAM)
de forma **standalone**: el programa se recibe por BLE, se guarda en flash con
wear-leveling y sobrevive a desconexiones y reseteos. También atiende el modo
live del editor (comandos inmediatos) por el mismo canal.

Basado en [codal-microbit-v2](https://github.com/lancaster-university/codal-microbit-v2)
con la plantilla de build de
[microbit-v2-samples](https://github.com/lancaster-university/microbit-v2-samples) (MIT).

## Estructura

```
source/
├── main.cpp              # boot: autorun desde flash (safe mode: botón A) + loop cooperativo
├── vm/stx_isa.h          # ★ FUENTE DE VERDAD del bytecode STX1 (ver gen_js_constants.py)
├── vm/stx_vm.c           # intérprete multi-contexto — C portable, sin CODAL
├── vm/stx_image.c        # validación de imagen (magic/CRC32) — C portable
├── proto/stx_proto.h     # ★ FUENTE DE VERDAD del protocolo BLE
├── proto/stx_proto_engine.c  # framing + transferencia + control — C portable
├── storage/stx_store.c   # wear-leveling round-robin en 4 páginas — C portable
├── storage/stx_store_codal.cpp  # glue MicroBitFlash (0x78000-0x7BFFF)
├── hal/stx_hal.h         # interfaz HAL — C portable
├── hal/stx_hal_codal.cpp # display/buzzer/botones/luz/mic (motores: kit v2)
└── ble/stx_ble.cpp       # MicroBitUARTService (Nordic UART) ↔ protocolo
```

Regla dura: todo lo marcado "C portable" compila con gcc nativo sin CODAL y se
testea en la computadora (`tests/host/`). Solo `main.cpp`, `*_codal.cpp` y
`stx_ble.cpp` tocan CODAL.

## Tests en host (sin placa)

```bash
make -C tests/host test
```

Cubren VM (loops anidados, eventos por flanco, presupuesto por tick, faults),
storage (rotación, generaciones, cortes de energía inyectados) y protocolo
(transferencia completa, re-ACK de duplicados, reensamblado de stream, timeouts).

## Build del hex (requiere toolchain ARM)

```bash
# Toolchain (una vez): descargar arm-gnu-toolchain darwin-arm64 de developer.arm.com
# y descomprimir p.ej. en ~/.local/toolchains/, o: brew install --cask gcc-arm-embedded
export PATH="$HOME/.local/toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin:$PATH"

python3 build.py          # clona dependencias CODAL en libraries/ (primera vez) y compila
# resultado: MICROBIT.hex
```

Primer flasheo: conectar la micro:bit por USB y arrastrar `MICROBIT.hex` al
drive `MICROBIT`. Después de eso, los programas de los niños viajan por BLE —
el hex solo se reflashea cuando cambia el firmware.

## Sincronización con el editor JS

Las constantes del bytecode y del protocolo se exportan al editor con:

```bash
python3 tools/gen_js_constants.py   # regenera ../Program/STXConstants.js
```

Nunca editar `Program/STXConstants.js` a mano.

## Notas de diseño

- **Flash**: la imagen se recibe entera en un buffer RAM de 2 KB y se escribe
  una sola vez en `XFER_END` (nunca por chunk) — `sd_flash_*` con BLE activo es
  asíncrono y lento. Wear-leveling: 4 páginas × ~10k ciclos ≈ 40k guardados.
- **Atomicidad**: el magic del slot se escribe último; un corte de energía deja
  vigente la versión anterior.
- **Safe mode**: botón A presionado al encender ⇒ no autorun (muestra "-").
- **Errores de runtime**: la VM se detiene, apaga actuadores y el código de
  error queda consultable con GET_STATUS.
