# Alabanza

Cancionero web con transpositor, pads ambientales y metrónomo, pensado para usarse en el escenario desde el celular. Los datos viven en Google Sheets; la app es estática y se publica gratis en GitHub Pages.

## Estructura

Todos los archivos van sueltos en la raíz del repositorio (sin carpetas):

```
index.html  styles.css
theme.js  music.js  ui.js  audio-core.js  database.js  pads.js  metronome.js  setlist.js
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
- **Inicio:** al abrir la app aparece un menú con Biblioteca, Setlist, Pad y Metrónomo.
- **Tema:** el botón de sol/luna alterna entre oscuro y claro (también dentro del visor). Se recuerda en el dispositivo.
- **Pad y metrónomo:** el botón de pad dentro del visor toca el tono actual; el metrónomo toma el BPM de la canción. El pad tiene ecualizador (graves, medios, agudos) y ambiente (reverb). El metrónomo acepta cualquier compás de 1/1 a 16/16; el BPM marca la figura del denominador, y en 6/8, 9/8 y 12/8 se acentúa cada grupo de 3.
- **Sin internet:** se muestra la última copia guardada en el dispositivo (solo lectura).

## Notas

- Edita canciones desde la app, no directamente en el Sheet.
- Para cambiar el PIN, edita `ADMIN_PIN` en `Code.gs` y publica una nueva versión.
