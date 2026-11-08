'use strict';
// Writes the Claude Code plugin's slash commands (claude/commands/*.md) from the
// MCP prompts in src/prompts.js, so both always say the same thing.
// Run: node scripts/claude-commands.js   (test/plugin.test.js checks they are current)
const fs = require('node:fs');
const path = require('node:path');
const { PROMPTS } = require('../src/prompts');

const DIR = path.join(__dirname, '..', 'claude', 'commands');

function render(prompt) {
  const arg = prompt.arguments[0];
  const body = prompt.text(arg ? { [arg.name]: '$ARGUMENTS' } : {});
  const front = ['---', `description: ${prompt.description}`];
  if (arg) front.push(`argument-hint: ${arg.required ? `<${arg.name}>` : `[${arg.name}]`}`);
  front.push('---', '');
  const tail = arg && !arg.required ? `\n\nIf $ARGUMENTS is empty, leave "${arg.name}" out.` : '';
  return `${front.join('\n')}${body}${tail}\n`;
}

const files = () => Object.fromEntries(PROMPTS.map((p) => [`${p.name}.md`, render(p)]));

if (require.main === module) {
  fs.mkdirSync(DIR, { recursive: true });
  for (const [name, text] of Object.entries(files())) fs.writeFileSync(path.join(DIR, name), text);
  console.log(`Wrote ${Object.keys(files()).length} commands to ${path.relative(process.cwd(), DIR)}`);
}

module.exports = { files, DIR };
