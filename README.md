# Alabanza

Cancionero web con transpositor, pads ambientales y metrónomo, pensado para usarse en el escenario desde el celular. Los datos viven en Google Sheets; la app es estática y se publica gratis en GitHub Pages.

## Estructura

Todos los archivos van sueltos en la raíz del repositorio (sin carpetas):

```
index.html  styles.css
theme.js  music.js  ui.js  audio-core.js  database.js  pads.js  metronome.js  perc.js  tuner.js  synth.js  setlist.js
Code.gs   (NO se sube a GitHub; vive en Apps Script)
.gitignore
```

## Puesta en marcha

**1. Google Sheet.** Crea una hoja de cálculo y copia su ID (la parte larga de la URL, entre `/d/` y `/edit`).

**2. Apps Script.** En el Sheet: Extensiones > Apps Script. Pega todo `Code.gs` y cambia:

- `SHEET_ID` por el ID de tu hoja.
- `ADMIN_PIN` por el PIN que quieras. El PIN se valida en el servidor.

Ejecuta una vez `initializeSheets` (acepta los permisos). Crea las hojas `Canciones` y `Setlists` con sus encabezados.

**3. Publicar la API.** Implementar > Nueva implementación > Aplicación web:

- Ejecutar como: **Yo**
- Quién tiene acceso: **Cualquier persona**

Copia la URL que termina en `/exec`.

**4. Conectar la app.** En `database.js` reemplaza `TU_APPS_SCRIPT_URL_AQUI` por esa URL.

**5. Probar.** Abre la carpeta con un servidor local (`python -m http.server 8000`) y entra a `http://localhost:8000`. No abras `index.html` con doble clic: los navegadores limitan algunas funciones en `file://`.

**6. Publicar.** Sube todo menos `Code.gs` a un repositorio de GitHub y activa Settings > Pages (rama `main`, carpeta `/ (root)`).

> Si cambias `Code.gs` más adelante, en Apps Script usa Implementar > Administrar implementaciones > Editar > **Nueva versión**. Si no, la URL sigue sirviendo el código anterior.

## Uso

- **Modo administrador:** toca el icono de usuario e ingresa tu PIN. Aparecen los botones para agregar, editar y eliminar canciones y para armar setlists.
- **Formato de letra:** acordes entre corchetes justo antes de la sílaba: `[C]Gran[Am]de es el [F]Señor`. Una línea sola como `[Coro]` crea un título de sección. Se aceptan acordes como `Cmaj7`, `G7sus4` y `C/E`.
- **Visor:** vista Cantante (solo letra) o Músico (acordes sobre la sílaba), transpositor ±1 semitono (toca el tono para volver al original), tamaño de letra y pantalla siempre encendida mientras está abierto.
- **Setlist:** cada canción tiene su tono para el servicio. Al abrirla desde el setlist ya aparece transpuesta a ese tono.
- **Inicio:** al abrir la app solo aparece el menú principal (Biblioteca, Setlist, Pad, Metrónomo, Percusión, Afinador y Sintetizador); ahí también aparece el logo, que cambia según el tema. Las barras de navegación aparecen al entrar a cualquier sección.
- **Compás:** cada canción guarda su compás (4/4, 6/8, etc.). Se ve junto al BPM y al abrir la canción el metrónomo se ajusta solo.
- **Tema:** el botón de sol/luna alterna entre oscuro y claro (también dentro del visor). Se recuerda en el dispositivo.
- **Pad y metrónomo:** el botón de pad dentro del visor toca el tono actual; el metrónomo toma el BPM de la canción. El pad tiene ecualizador (graves, medios, agudos) y ambiente (reverb). El metrónomo acepta cualquier compás de 1/1 a 16/16. En compases simples el BPM marca la figura del denominador; en compuestos (6/8, 9/8, 12/8) el BPM marca el pulso de 3 (negra con puntillo) y suenan los 3 subpulsos. 5/8 = 3+2 y 7/8 = 2+2+3.
- **Metrónomo en compases compuestos:** en 6/8, 9/8 y 12/8 aparece un selector. "BPM = pulso de 3" (por defecto) marca la negra con puntillo; "BPM = cada corchea" es como cuentan la mayoría de metrónomos y videos. El mismo número de BPM suena 3 veces más rápido en el primer modo.
- **Percusión:** pads para tocar en pantalla (multitáctil) con sonidos de worship. Banco 1: Bombo, Caja, Cross-stick, Pandero, Shaker y Tom grave. Banco 2: Aplauso, Crash, Hi-hat, Hi-hat abierto, Tom medio y Tom agudo. Volumen y ambiente (reverb). En PC: Q W E / A S D. Todo suena sintetizado, sin archivos de audio.
- **Intro:** al abrir la app aparece el logo oscuro (`logo_pagina_2.jpg`) sobre negro con luz, y se desvanece para entrar. Tocar la pantalla la salta.
- **Afinador:** cromático (detecta cualquier nota, sirve para cualquier instrumento). Necesita permiso de micrófono (HTTPS o localhost).
- **Sintetizador:** teclado multitáctil con 5 sonidos, octavas, sostenido, ambiente y brillo.
- **Sin internet:** se muestra la última copia guardada en el dispositivo (solo lectura).

## Notas

- Edita canciones desde la app, no directamente en el Sheet.
- Para cambiar el PIN, edita `ADMIN_PIN` en `Code.gs` y publica una nueva versión.

- **Actualizar Code.gs:** esta versión agrega la columna `Compas` (G) en `Canciones` y la acción `getAll`. Pega el nuevo `Code.gs`, ejecuta `initializeSheets` una vez y publica **Nueva versión**. Mientras tanto la app sigue funcionando con la versión anterior del script.

- **Logos:** `logo_app.jpg` es el icono de la pestaña del navegador; `logo_pagina.jpg` (tema claro) y `logo_pagina_2.jpg` (tema oscuro) se ven en el inicio. Súbelos a la raíz junto con los demás archivos.
- **Compás en Sheets:** la columna `Compas` debe ser texto, si no Sheets convierte "6/8" en fecha. `initializeSheets` ya la deja así; `getSongs` también repara celdas que ya se habían convertido.
