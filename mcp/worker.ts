import { createDefaultProject } from '../projectDefaults.ts';
import { createProjectLink, readProjectFromUrl, validateSharedProject } from '../projectSharing.ts';
import { SHEET_FINISHES, getAvailableSheetThicknesses, checkSheetMetalFeasibility, getHoleRadii, getMaxFlatCornerRadius } from '../sheetGeometry.ts';
import { saveHoles } from '../holeEditing.ts';
import { getGrainConstraints } from '../grainConstraints.ts';

const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
export const tools = [
  { name: 'list_materials', description: 'Matières et finitions disponibles. Dimensions en mm. Filtrer selon le nombre de plis.', annotations,
    inputSchema: { type: 'object', properties: { bendCount: { type: 'integer', minimum: 0, maximum: 4 } }, additionalProperties: false } },
  { name: 'create_piece', description: 'Configurer une plaque rectangulaire ou une pièce pliée, vérifier les contraintes et retourner son lien. Pas de commande ni paiement. Le STEP et le PDF se téléchargent dans le configurateur. Les trous sont ronds, diamètre 5 mm par défaut. Les longueurs des ailes sont des cotes extérieures.', annotations,
    inputSchema: { type: 'object', required: ['bendCount', 'finish', 'thickness', 'width', 'legLengths'], additionalProperties: false,
      properties: { bendCount: { type: 'integer', minimum: 0, maximum: 4 }, finish: { type: 'string', enum: Object.keys(SHEET_FINISHES) }, thickness: { type: 'number', exclusiveMinimum: 0 }, width: { type: 'number', exclusiveMinimum: 0 },
        legLengths: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'number', exclusiveMinimum: 0 } }, angles: { type: 'array', maxItems: 4, items: { type: 'number', minimum: -165, maximum: 165 } }, directions: { type: 'array', maxItems: 4, items: { type: 'integer', enum: [-1, 1] } },
        cornerRadii: { type: 'object', additionalProperties: false, description: 'Rayons en mm sur le développé, face de finition. Début = bord libre aile A, fin = bord libre dernière aile. Gauche/droite selon les repères du configurateur, pas selon la caméra. Coins omis = 0. Demander lequel si ambigu.', properties: { startLeft: { type: 'number', minimum: 0 }, startRight: { type: 'number', minimum: 0 }, endLeft: { type: 'number', minimum: 0 }, endRight: { type: 'number', minimum: 0 } } },
        grainDirection: { type: 'string', enum: ['length', 'width'] }, holes: { type: 'array', maxItems: 100, items: { type: 'object', required: ['leg', 'dist', 'offset'], additionalProperties: false, properties: { leg: { type: 'integer', minimum: 0, maximum: 4 }, dist: { type: 'number' }, offset: { type: 'number' }, diameter: { type: 'number', exclusiveMinimum: 0 } } } } } } },
  { name: 'inspect_piece', description: 'Relire et vérifier une pièce depuis son lien de partage du configurateur.', annotations,
    inputSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string', maxLength: 32000 } }, additionalProperties: false } },
];

/** Stateless calculations only: project data stays in the returned share link. */
export function callTool(name: string, args: any) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Arguments invalides.');
  if (name === 'list_materials') {
    const bends = args.bendCount ?? 0;
    if (!Number.isInteger(bends) || bends < 0 || bends > 4) throw new Error('Nombre de plis invalide.');
    return { stock: { length: 2980, width: 1480, unit: 'mm' }, maximumBendingThickness: 6,
      finishes: Object.entries(SHEET_FINISHES).map(([id, finish]) => ({ id, ...finish, thicknesses: getAvailableSheetThicknesses(id as any, bends) })).filter(finish => finish.thicknesses.length) };
  }
  let project;
  if (name === 'inspect_piece') {
    if (typeof args.url !== 'string' || args.url.length > 32000) throw new Error('Lien invalide.');
    project = readProjectFromUrl(args.url);
    if (!project) throw new Error('Ce lien ne contient pas de projet.');
  } else if (name === 'create_piece') {
    const state = createDefaultProject();
    const finish = SHEET_FINISHES[args.finish as keyof typeof SHEET_FINISHES];
    if (!finish || !Number.isInteger(args.bendCount) || args.bendCount < 0 || args.bendCount > 4) throw new Error('Finition ou nombre de plis invalide.');
    if (!Array.isArray(args.legLengths) || args.legLengths.length !== args.bendCount + 1) throw new Error('Fournir une longueur par aile (nombre de plis + 1).');
    for (const key of ['angles', 'directions']) if (args[key] !== undefined && (!Array.isArray(args[key]) || args[key].length !== args.bendCount)) throw new Error('Fournir un angle et un sens par pli.');
    Object.assign(state, { bendCount: args.bendCount, finish: args.finish, material: finish.family, thickness: args.thickness, width: args.width });
    state.legs.forEach((leg, index) => { leg.length = args.legLengths[index] ?? 100; });
    state.bends.forEach((bend, index) => { bend.angle = args.angles?.[index] ?? 90; bend.direction = args.directions?.[index] ?? 1; });
    project = validateSharedProject({ state, grainDirection: args.grainDirection ?? 'length' });
    // Reject out-of-range radii instead of the renderer silently clamping them.
    if (args.cornerRadii !== undefined) {
      if (!args.cornerRadii || typeof args.cornerRadii !== 'object' || Array.isArray(args.cornerRadii)) throw new Error('Rayons des coins invalides.');
      const keys = ['startLeft', 'startRight', 'endLeft', 'endRight'] as const;
      if (Object.keys(args.cornerRadii).some(key => !keys.includes(key as any))) throw new Error('Repère de coin inconnu.');
      for (const key of keys) {
        const value = args.cornerRadii[key] ?? 0;
        const maximum = getMaxFlatCornerRadius(project.state, key);
        if (!Number.isFinite(value) || value < 0 || value > maximum) throw new Error(`Rayon ${key} invalide : choisir entre 0 et ${maximum} mm.`);
        project.state.cornerRadii[key] = value;
      }
    }
    if (args.holes !== undefined && (!Array.isArray(args.holes) || args.holes.length > 100)) throw new Error('Maximum 100 trous.');
    for (const hole of args.holes ?? []) {
      if (!Number.isInteger(hole.leg) || hole.leg < 0 || hole.leg > state.bendCount || !Number.isFinite(hole.diameter ?? 5) || (hole.diameter ?? 5) <= 0) throw new Error('Trou invalide.');
      const leg = project.state.legs[hole.leg];
      const candidate = { dist: hole.dist, offset: hole.offset, diam: hole.diameter ?? 5, shape: 'round' as const };
      if ((leg.holePositions ?? []).some(other => { const radius = getHoleRadii({ holeDiam: other.diam }); return Math.abs(other.dist - hole.dist) < radius.rx + candidate.diam / 2 + 2 && Math.abs(other.offset - hole.offset) < radius.rz + candidate.diam / 2 + 2; })) throw new Error('Trous trop proches : conserver au moins 2 mm de matière.');
      const next = saveHoles(project.state, leg.id, [candidate]);
      if (next === project.state) throw new Error('Trou hors de la plaque ou dans la zone de sécurité d’un pli.');
      project.state = next;
    }
  } else throw new Error('Outil inconnu.');
  const report = checkSheetMetalFeasibility(project.state);
  const grain = getGrainConstraints(project.state, project.grainDirection);
  const valid = report.isFeasible && grain.valid;
  return { valid, project, report, grain, url: valid ? createProjectLink(project.state, project.grainDirection) : null,
    nextAction: valid ? 'Présenter le champ url comme lien « Ouvrir ma pièce configurée ». Le site charge les dimensions, plis, matière et trous depuis ce lien. Ne pas remplacer ce lien par la page d’accueil.' : 'Corriger les contrôles bloquants avant de proposer un lien.',
    notice: 'Contrôles indicatifs du configurateur, pas une certification de fabrication. Aucun envoi au deck ni achat effectué.' };
}

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
export async function handleMcp(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  // Bound the stream before parsing, including requests without Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return json({ error: 'Empty request' }, 400);
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 128000) { await reader.cancel(); return json({ error: 'Request too large' }, 413); } chunks.push(value); }
  let message: any;
  try { const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } message = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string' || Array.isArray(message)) return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
  const reply = (result: unknown) => json({ jsonrpc: '2.0', id: message.id, result });
  if (message.id === undefined) return new Response(null, { status: 202 });
  if (message.method === 'initialize') return reply({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'step-by-step', version: '1.1.0' }, instructions: 'Recueillir les dimensions en mm, les plis et la finition. Utiliser list_materials puis create_piece. Si valid=true, présenter exactement url comme lien Ouvrir ma pièce configurée. Ce lien ouvre la pièce complète dans le visualisateur. Le navigateur peut ensuite exporter le STEP et envoyer au deck. Ne pas inventer de lien ni prétendre qu’un envoi au deck ou un achat a déjà eu lieu.' });
  if (message.method === 'ping') return reply({});
  if (message.method === 'tools/list') return reply({ tools });
  if (message.method === 'tools/call') {
    // Only the Sites dispatcher supplies this identity; no custom OAuth or token.
    if (!request.headers.get('oai-authenticated-user-id')) return json({ error: 'Authentication required' }, 401);
    try { const result = callTool(message.params?.name, message.params?.arguments ?? {}); return reply({ content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result }); }
    catch (error) { return reply({ isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'Configuration invalide.' }] }); }
  }
  return json({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } });
}

export default {
  async fetch(request: Request, env: { ASSETS: { fetch(request: Request): Promise<Response> } }) {
    if (new URL(request.url).pathname === '/mcp') return handleMcp(request);
    return env.ASSETS.fetch(request);
  },
};
