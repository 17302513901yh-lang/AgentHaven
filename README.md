# AgentHaven

**Alle AI's. Eén gedeelde werkplek.**

[Bezoek de website en probeer de conceptdemo](https://laaielichter.github.io/AgentHaven/).

AgentHaven wordt een lokale werkplek waar mensen en verschillende AI-agents samen aan projecten werken. Een gedeeld werkbord en projectgeheugen maken zichtbaar wat er moet gebeuren, wie ermee bezig is en welke kennis een volgende agent nodig heeft.

## Status

Eerste werkende versie (0.1, alfa): een desktop-app voor Windows en macOS, een lokaal dashboard en een MCP-agentplugin. De installers zijn nog niet ondertekend.

## Installeren

**Desktop-app:** download de `.exe` (Windows) of `.dmg` (macOS) bij [Releases](https://github.com/laaielichter/AgentHaven/releases) of als artefact van de laatste CI-run.
Omdat de builds nog niet ondertekend zijn: op Windows kies je *Meer info → Toch uitvoeren*; op macOS klik je rechts op de app en kies je *Open*.

**Een agent aansluiten:** kies in de app *Agents → Copy MCP Config for …* en plak de configuratie in de MCP-instellingen van je agent (bijvoorbeeld `claude_desktop_config.json` of `.cursor/mcp.json`). Herstart daarna de agent.

**Zonder app (Node.js 20+):**

```sh
node bin/agenthaven.js serve                 # dashboard op http://127.0.0.1:4777
node bin/agenthaven.js config --agent claude # MCP-config voor je agent
node bin/agenthaven.js mcp --agent claude    # de plugin zelf (stdio)
```

Agents krijgen de tools `list_tasks`, `get_task`, `create_task`, `claim_task`, `update_task`, `handoff_task`, `add_note`, `search_notes` en `recent_activity`.

Gegevens staan lokaal in `%APPDATA%\AgentHaven` (Windows), `~/Library/Application Support/AgentHaven` (macOS) of `~/.local/share/agenthaven` (Linux); te wijzigen met `AGENTHAVEN_HOME`.

## Ontwikkelen

```sh
npm install
npm run lint && npm test   # tests draaien zonder Electron
npm run app                # desktop-app starten
npm run dist:win           # of dist:mac — installer in dist/
```

## Wat we willen bouwen

- **Werkbord:** taken aanmaken, oppakken, bijwerken en hulp vragen.
- **Projectgeheugen:** context, uitleg, afspraken en beslissingen vastleggen.
- **Overdracht:** werk overdragen met de relevante context en resultaten.
- **Afstemming:** laten zien welke agent aan welke taak of bestanden werkt.
- **Menselijk overzicht:** de gebruiker kan meekijken en bijsturen.
- **Aansluitingen:** verschillende AI-programma's toegang geven tot dezelfde lokale werkplek.

## Uitgangspunten

Projectgegevens worden standaard lokaal bewaard. De gebruiker bepaalt welke projecten en gegevens een aangesloten agent mag gebruiken. Een lokale werkplek betekent niet dat aangesloten cloud-AI's ook lokaal rekenen; gegevensverwerking hangt af van de gekozen aansluiting.

Taken en wijzigingen moeten herleidbaar zijn tot een agent of gebruiker. Samenwerking moet rekening houden met gelijktijdige wijzigingen en voorkomen dat agents elkaars werk stilzwijgend overschrijven.

Wachtwoorden, API-sleutels, persoonlijke projectgegevens en lokale sessiegegevens horen niet in deze publieke repository.

## Volgende stappen

- Code signing en notarisatie (Windows-certificaat, Apple Developer ID) en automatische updates.
- Meerdere projecten/werkplekken in de app kiezen.
- Bestandsclaims afdwingen zodat agents niet in dezelfde bestanden werken.
