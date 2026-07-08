# CLAUDE.md — Proyecto: editor de programación horizontal para micro:bit (SmartTEAM)

## Contexto

Este repo es un fork de `BirdBlox-FinchBlox-JS-Frontend` (BirdBrain Technologies, MIT). Es el motor de bloques + UI de **FinchBlox**, un editor de programación horizontal (estilo ScratchJr) para pre-lectores, en HTML/JS/SVG puro, sin framework. Originalmente programa robots Finch/Hummingbird (que usan micro:bit como procesador) enviando comandos BLE **en vivo** — cada bloque manda un comando inmediato (`/robot/out/led`, `/robot/out/triled`, etc.) y si se corta el Bluetooth, el bloque queda inerte.

## Objetivo de este fork

Agregar un **modo de programa consolidado**: en vez de (o además de) mandar comandos en vivo, compilar el árbol de bloques a bytecode, transferirlo a la micro:bit, y que la placa lo guarde en flash y lo siga ejecutando **standalone, aunque se desconecte el Bluetooth o se resetee**. El modo en vivo original se mantiene como segunda opción (toggle), no se elimina.

La app final tiene que correr como **una sola base de código en computadora y en móvil** (iOS/Android/desktop).

## Restricciones técnicas verificadas (no reabrir estas decisiones sin nueva evidencia)

- **Licencia**: MIT confirmada en el repo original. Fork y modificación libres.
- **micro:bit V2 (nRF52833)**: 512 KB flash, 128 páginas de 4 KB, no volátil. Endurance ~10.000 ciclos de borrado/escritura por página. **Cualquier implementación de escritura en flash debe usar wear-leveling (rotar entre varias páginas dedicadas), no escribir siempre en la misma página.**
- **Web Bluetooth no existe en Safari de iOS/iPadOS** (ninguna versión, sin plan de Apple). Por eso el cliente cross-platform no puede ser "solo una web app": en desktop (Chrome/Edge) puede correr directo en navegador con Web Bluetooth/WebUSB; en iOS/Android necesita wrapper nativo con plugin BLE real. Usar **Capacitor** para empaquetar este mismo frontend en iOS/Android.
- El repo original (`BirdBlox-FinchBlox-JS-Frontend`) está **archivado por BirdBrain desde el 5/jun/2026** — sin soporte upstream futuro. Mantenimiento 100% propio desde ahora.

## Punto de inserción en el código

El árbol de bloques ya se arma internamente antes de convertirse en comandos live: `CodeManager` → `Tabs` → `BlockStacks` → `Blocks` → `Slots`. El compilador nuevo debe engancharse ahí, tomando ese árbol como entrada en lugar de (o además de) despachar comandos inmediatos.

## Fases (ejecutar en orden, no saltear)

### Fase 0 — Setup y auditoría
- Correr el frontend standalone en navegador (sin el wrapper nativo original de BirdBrain).
- Confirmar visualmente que el modo FinchBlox (no BirdBlox) renderiza en gramática horizontal real.
- Localizar en el código exacto dónde vive `CodeManager`/`BlockStacks` y cómo se despachan hoy los comandos live.
- Entregable: notas de auditoría + confirmación de que el punto de inserción es viable.

### Fase 1 — Compilador y elección de VM embebida
- Evaluar **Jacscript** (VM de MicroCode/Microsoft, ya corre standalone en micro:bit V2, activamente mantenida) como runtime destino, vs. escribir una VM propia mínima en C/CODAL.
- Criterio: cuánto del vocabulario de bloques necesario (LEDs, sensores, motores/servos según el kit SmartTEAM) ya cubre Jacscript vs. cuánto habría que extenderle.
- Escribir el serializador: árbol de `BlockStacks` → bytecode del runtime elegido.
- Definir protocolo de transferencia por BLE (empaquetado, checksums, confirmación de escritura).

### Fase 2 — Firmware: recepción, flash y ejecución standalone
- Recepción de bytecode por BLE.
- Escritura en flash con wear-leveling (2-8 páginas dedicadas, rotación).
- Arranque del intérprete leyendo desde flash al bootear, sin depender de conexión activa.

### Fase 3 — Modo dual
- Mantener el modo en vivo original como toggle en la UI.
- Verificar que ambos modos no compiten por el mismo estado del editor.

### Fase 4 — Cliente cross-platform
- Empaquetar con Capacitor para iOS/Android (BLE nativo).
- Validar Web Bluetooth/WebUSB directo para el caso desktop, sin wrapper.
- Un solo pipeline de build para las tres plataformas.

### Fase 5 — Reskin visual (puede correr en paralelo a Fases 2-4)
- Iconografía, paleta y tema propios de SmartTEAM sobre el SVG existente. No tocar lógica de ejecución en esta fase.

### Fase 6 — Piloto en aula

## Qué no hacer

- No perseguir opciones alternativas de gramática horizontal (ya evaluadas y descartadas: scratch-blocks incompleto, ScratchJr bespoke no reusable, MicroCode es grid no horizontal, code.org es vertical). Este repo es la base definitiva.
- No implementar escritura en flash sin wear-leveling, ni siquiera como prototipo — el hábito se traslada a producción.
- No eliminar el modo en vivo original al implementar el modo consolidado.
