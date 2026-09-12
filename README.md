# bugme 🐛

Tracker público de errores de **Pulsar OS**. Los usuarios reportan bugs en GitHub Issues
(especificando versión, explicando el error y aportando debug), cada reporte se notifica en
Discord y este sitio se regenera automáticamente con el tracking completo y los hilos de
comentarios.

Estética *Apple-like*, sitio 100 % estático, sin dependencias de runtime.

## Cómo reportar un error

1. Ve a **Issues → New issue → Bug report** (o usa la web de tracking → "Reportar un error").
2. Rellena el formulario:
   - **Versión de Pulsar OS** (ISO/imagen que usas)
   - **Explica el error** (qué pasó, qué esperabas, pasos para reproducirlo)
   - **Información de debug** (logs, `journalctl`, capturas…)
   - **Gravedad**
3. Listo: se notificará en Discord y aparecerá en el tracker al regenerarse el sitio.

## Arquitectura

```
Issue (formulario) ──► workflow notify-discord.yml ──► Discord (webhook, org secret DISCORD_WEBHOOK)
        │
        └─► workflow build-tracker.yml ──► node build.mjs ──► GitHub Pages (tracker con hilos)
```

- `.github/ISSUE_TEMPLATE/bug_report.yml` — formulario de bug (versión, error, debug, gravedad).
- `.github/workflows/notify-discord.yml` — envía cada issue nueva a Discord vía embed.
- `.github/workflows/build-tracker.yml` — descarga issues + comentarios con `gh api`,
  genera `site/index.html` y lo publica en GitHub Pages. Se ejecuta en cada issue/comentario,
  cada hora y manualmente.
- `build.mjs` — generador estático (Node sin dependencias) que parsea el cuerpo del formulario,
  clasifica por gravedad y renderiza la web estilo Apple.

## Configuración

- **Webhook de Discord:** ya configurado como *organization secret* `DISCORD_WEBHOOK`. Si el
  org secret no es accesible desde este repo, créalo también como repo secret con el mismo nombre.
- **GitHub Pages:** Settings → Pages → Source: **GitHub Actions**.

## Desarrollo local

```bash
# sample data si no existe data/
node build.mjs
# → site/index.html
```
