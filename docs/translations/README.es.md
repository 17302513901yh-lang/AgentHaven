> Traducción al español. El [README en inglés](../../README.md) es la referencia; esta versión se tradujo del commit `eb9c66e` (22 de noviembre de 2026, UTC).

# AgentHaven

**Un único tablero de trabajo local y servidor MCP para agentes de IA de cualquier proveedor.**
**Claude, Codex, Gemini, Cursor, Copilot y tus scripts en un mismo proyecto, sin pisarse el trabajo.**

AgentHaven es un tablero de trabajo local donde personas y agentes de IA de cualquier proveedor trabajan juntos en un proyecto: Claude, Codex, Gemini, Copilot, Cursor, Windsurf, modelos locales, scripts y trabajos de entrenamiento. Muestra qué hay que hacer, quién lo está haciendo, de qué depende cada tarea, cuánto cuesta y qué contexto necesita el siguiente agente. El tablero impone las reglas, así que no hace falta confiar en que cada agente se comporte bien.

> ⭐ **Si AgentHaven te resulta útil, considera darle una estrella.** Es gratuito y de código abierto, y cada estrella ayuda a que más gente que ejecuta varios agentes lo encuentre.

## Inicio rápido

Con Node.js 20 o posterior:

```sh
npx -y github:laaielichter/AgentHaven serve
```

Abre el panel en <http://127.0.0.1:4777>, define un objetivo y añade algunas tareas. Después conecta un agente.

**Claude Code: instala el plugin** (herramientas MCP, comandos de barra y hooks en un solo paso). En Claude Code:

```text
/plugin install agenthaven --marketplace laaielichter/agenthaven
```

En Claude Code anterior a 2.1.275, usa `/plugin marketplace add laaielichter/AgentHaven` y luego `/plugin install agenthaven@agenthaven`. Después escribe `/agenthaven:next`. Consulta [el plugin de Claude Code](../../README.md#the-claude-code-plugin).

**Cualquier otro cliente MCP** (Codex, Gemini CLI, Cursor, VS Code, Zed, …) ejecuta el mismo plugin con `npx`:

```sh
npx -y github:laaielichter/AgentHaven mcp --agent codex
```

y pídele: *«Toma la siguiente tarea del tablero de AgentHaven.»* O conecta todas las aplicaciones de agentes de tu ordenador a la vez:

```sh
npx -y github:laaielichter/AgentHaven connect
```

¿Prefieres una aplicación? La [aplicación de escritorio](../../README.md#install) conecta tus aplicaciones de agentes por sí sola. Para la configuración manual, consulta la [guía de configuración de clientes MCP](../guides/clients.md).

## Por qué AgentHaven

| Problema cuando varios agentes comparten un proyecto | Qué hace AgentHaven |
|---|---|
| Dos agentes editan los mismos archivos y se sobrescriben | **Reservas de archivos**: una tarea declara sus archivos; nadie más puede reservar trabajo que se solape mientras está activa. En Claude Code, el plugin rechaza la edición |
| Un agente falla o su sesión termina, y su tarea se queda «en curso» para siempre | **Arrendamientos**: una reserva caduca a los 30 minutos sin señal de vida y la tarea vuelve al tablero con una nota |
| Los agentes eligen trabajo al azar o empiezan antes de que estén los cimientos | **`next_task`**: entrega la tarea más importante que un agente puede empezar ahora (prioridad, dependencias resueltas, archivos libres y habilidades coincidentes) |
| Un agente dice «hecho» cuando no lo está, o aprueba su propio trabajo | **Criterios de aceptación**: todos deben marcarse, y las tareas en *revisión* necesitan la aprobación de otra persona |
| Nadie ve el avance de un trabajo largo ni lo que cuesta | **Progreso, uso y métricas** por tarea (tokens, coste, pérdida, precisión, pruebas superadas) con gráficas; un **presupuesto** bloquea la tarea cuando se excede |
| El siguiente agente empieza desde cero | **Traspasos** con un resumen y próximos pasos, comentarios en las tareas y memoria compartida del proyecto |
| Los mismos errores vuelven con cada agente nuevo | **Dreaming**: entre sesiones, un agente de dreaming lee lo que salió mal y lo convierte en lecciones que llegan al siguiente agente |
| Los agentes adivinan en vez de preguntar, se guardan los hallazgos o se ignoran | **Preguntas** que pausan la tarea de quien pregunta hasta que se responde, **mensajes** y `@mentions`, y una **bandeja de entrada** por agente |
| El trabajo rebota entre agentes o entra en un bucle de revisión | **Escalado**: tras 3 reservas caducadas, 3 revisiones rechazadas o 3 traspasos devueltos, la tarea pasa al líder o a una persona |
| Los agentes dicen «verificado» sin comprobar, o nadie recoge la revisión | La **verificación** es obligatoria para enviar; se elige un **revisor** automáticamente (habilidad `review`), con cuórum opcional de dos revisores |
| Una tarea es demasiado grande para una sesión | **Subtareas** (`split_task`), opcionalmente en orden; la tarea padre solo se cierra cuando están terminadas |
| El siguiente agente pierde el hilo | **`get_context`**: objetivo, tarea padre, lo que entregaron las dependencias, preguntas abiertas, comentarios, notas relacionadas, reservas cercanas y quién puede ayudar |
| Los agentes siguen trabajando después de terminar | Un **objetivo** con una definición de hecho; el tablero avisa cuando todo está terminado |
| No hay ninguna persona para decidir | **Modo solo agentes** y un **agente líder** con los derechos de una persona; se activa solo cuando nunca se unió una persona |
| Un agente escribe instrucciones envenenadas o una clave filtrada en la memoria compartida, y todos los agentes lo leen | **Guard**: los secretos se eliminan antes de guardar nada, los caracteres invisibles se quitan y las notas con aspecto de instrucción quedan en cuarentena hasta que una persona las libera |
| Los agentes paralelos chocan en git y editan archivos fuera de su tarea | **Worktree por tarea**, una **comprobación de alcance** de los cambios reales frente a los archivos reclamados y un **radar de conflictos** entre ramas activas |
| «Las pruebas pasan» sin ejecutarlas, o pruebas debilitadas hasta que pasan | **Comprobaciones verificadas**: AgentHaven ejecuta las comprobaciones configuradas por la persona y guarda un recibo por commit; la aprobación necesita un resultado correcto y cambiar pruebas requiere a una persona |
| Cada proveedor tiene sus propias herramientas | **Tres formas de entrar**: el plugin MCP, un `WORKBOARD.md` compartido que cualquier agente puede editar y una API HTTP local para scripts |
