import { readFile, writeFile, access } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  OllamaModel,
  SceneExtractor,
  bootstrap,
  canonicalNames,
  knownNamesFrom,
  listOllamaModels,
  renderProposal,
} from '@prosebind/extract';
import { Session } from './session.js';

/**
 * `prosebind bootstrap` — propose a bible from existing prose.
 *
 * The answer to "I already have 90,000 words, where do I start", and the capability
 * that makes the published benchmarks reachable: they supply stories with no bible, and
 * Tier 0 cannot check prose against entities nobody declared.
 *
 * It writes a proposal and never the writer's own bible. § 6 says extraction will be
 * wrong and the writer must be able to win the argument; silently authoring their canon
 * from a 4B model's reading would invert that.
 */
export interface BootstrapCommandOptions {
  root: string;
  model?: string;
  minScenes?: number;
  write: (text: string) => void;
}

const PROPOSAL = '.prosebind/bible/characters.proposed.yaml';

export async function runBootstrap(options: BootstrapCommandOptions): Promise<number> {
  const { root, write } = options;

  const available = await listOllamaModels();
  if (available.length === 0) {
    write(
      'No local model found.\n\n' +
        'Tier 1 needs one. Install Ollama and pull a small model:\n' +
        '  ollama pull gemma3:4b\n\n' +
        'Tier 0 keeps working without it — "prosebind check" needs no model at all.\n',
    );
    return 1;
  }

  const tag = options.model ?? (available.includes('gemma3:4b') ? 'gemma3:4b' : available[0]!);
  const model = new OllamaModel({ model: tag, timeoutMs: 180_000 });
  if (!(await model.available())) {
    write(`Model "${tag}" is not available. Pulled models: ${available.join(', ')}\n`);
    return 1;
  }

  const session = await Session.open(root);
  await session.loadAll();
  const documents = [...session.documents.values()];
  if (documents.length === 0) {
    write(`No manuscript files under ${root}.\n`);
    return 1;
  }

  write(`Reading ${documents.length} file${documents.length === 1 ? '' : 's'} with ${tag}.\n`);
  write('Nothing leaves this machine.\n\n');

  const extractor = new SceneExtractor({
    model,
    onError: (segmentId, error) => write(`  ! ${segmentId}: ${error.message}\n`),
  });

  const result = await bootstrap({
    extractor,
    documents,
    knownNames: knownNamesFrom(session.graph),
    canonical: canonicalNames(session.graph),
    minScenes: options.minScenes ?? 1,
    onProgress: (done, total, scene) => {
      write(`  [${done + 1}/${total}] ${scene}\n`);
    },
  });

  const path = join(root, PROPOSAL);
  const existed = await access(path).then(
    () => true,
    () => false,
  );
  if (existed) {
    const previous = await readFile(path, 'utf8');
    if (!previous.includes('PROPOSED')) {
      // Refuse to clobber a file the writer has adopted as real canon.
      write(`\n${relative(root, path)} does not look like a proposal any more. Not overwriting it.\n`);
      return 1;
    }
  }

  await writeFile(path, renderProposal(result, tag), 'utf8');

  const seconds = (result.durationMs / 1000).toFixed(1);
  write(
    `\n${result.characters.length} characters, ${result.places.length} places, ` +
      `${result.events.length} events from ${result.scenesExamined} scenes in ${seconds}s.\n`,
  );
  write(`\nProposal written to ${PROPOSAL}\n`);
  write('Nothing in it is canon. Review it, delete what is wrong, then merge what\n');
  write('remains into characters.yaml — only then will Prosebind check against it.\n');

  return 0;
}
