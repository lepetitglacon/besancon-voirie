import { spawn } from 'node:child_process';
import { mkdir, open, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ETAPES_ACTIVES,
  MOTIF_ID_ESSAI,
  type EtapeLancement,
  type LancementSumo,
  type LancerEssaiSumo,
  type OptionsSumo,
} from '@voirie/schema';

/** État écrit par `lancer_essai.py` (temps en secondes depuis 1970). */
interface EtatFichier {
  etape: EtapeLancement;
  detail: string;
  debut: number;
  debutEtape?: number;
  fin?: number;
  pid: number;
  debutSimule?: number;
  finSimulee?: number;
  essaiId?: string;
  journal?: string;
}

/** Délai laissé au lanceur pour écrire son pid, en s. */
const DELAI_DEMARRAGE = 30;

/** Octets lus à la fin de summary.xml pour y trouver le dernier pas. */
const FIN_SUMMARY = 4096;

/** `20261009-2215-choix-au-depart` */
function identifiant(nom: string, date = new Date()): string {
  const deux = (n: number) => String(n).padStart(2, '0');
  const horodatage = `${date.getFullYear()}${deux(date.getMonth() + 1)}${deux(date.getDate())}-${deux(date.getHours())}${deux(date.getMinutes())}${deux(date.getSeconds())}`;
  const slug = nom
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `${horodatage}-${slug || 'essai'}`;
}

function vivant(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lancements d'essais SUMO : `lancer_essai.py` tourne détaché de l'API (il survit à son
 * redémarrage) dans `lancements/<id>/` ; son état se relit dans `etat.json` et `summary.xml`.
 * Un seul lancement à la fois : une journée de la ville occupe la machine.
 */
@Injectable()
export class LancementsSumoService {
  private readonly ville: string;
  private readonly python: string;

  constructor(config: ConfigService) {
    this.ville = resolve(config.get<string>('SUMO_VILLE_DIR', '../../data/sumo/ville'));
    this.python = config.get<string>('SUMO_PYTHON', join(homedir(), '.local/share/sumo-venv/bin/python'));
  }

  private dossier(id: string): string {
    if (!MOTIF_ID_ESSAI.test(id)) throw new NotFoundException(`Lancement « ${id} » introuvable`);
    return join(this.ville, 'lancements', id);
  }

  async options(): Promise<OptionsSumo> {
    return JSON.parse(await readFile(join(this.ville, 'options-sumo.json'), 'utf8')) as OptionsSumo;
  }

  async liste(): Promise<LancementSumo[]> {
    const ids = await readdir(join(this.ville, 'lancements')).catch(() => [] as string[]);
    const lancements = await Promise.all(ids.filter((id) => MOTIF_ID_ESSAI.test(id)).map((id) => this.lire(id).catch(() => null)));
    return lancements.filter((l) => l !== null).sort((a, b) => b.debut - a.debut);
  }

  async lancer(demande: LancerEssaiSumo): Promise<LancementSumo> {
    const enCours = (await this.liste()).find((l) => ETAPES_ACTIVES.includes(l.etape));
    if (enCours) throw new ConflictException(`Un essai est déjà en cours : « ${enCours.nom} »`);
    await this.verifierOptions(demande.options);

    const id = identifiant(demande.nom);
    const dossier = this.dossier(id);
    await mkdir(dossier, { recursive: true });
    await writeFile(join(dossier, 'parametres.json'), JSON.stringify(demande, null, 1));
    const journal = await open(join(dossier, 'lanceur.log'), 'a');
    // `setsid -f` : le lanceur quitte l'arbre de processus de l'API (que le rechargement à chaud de
    // Nest tue en entier) et devient chef de son groupe ; il écrit lui-même son pid dans etat.json.
    const processus = spawn('setsid', ['-f', this.python, join(this.ville, 'lancer_essai.py'), dossier], {
      cwd: this.ville,
      detached: true,
      stdio: ['ignore', journal.fd, journal.fd],
    });
    processus.unref();
    await journal.close();
    // État initial, avant que le lanceur n'écrive le sien (pid 0 : en cours de démarrage).
    const etat: EtatFichier = { etape: 'preparation', detail: 'Démarrage', debut: Date.now() / 1000, pid: 0 };
    await writeFile(join(dossier, 'etat.json'), JSON.stringify(etat));
    return this.lire(id);
  }

  async annuler(id: string): Promise<LancementSumo> {
    const dossier = this.dossier(id);
    const etat = await this.lireEtat(dossier);
    if (!ETAPES_ACTIVES.includes(etat.etape)) return this.lire(id);
    // Le lanceur est chef de son groupe de processus (detached) : SUMO s'arrête avec lui.
    try {
      process.kill(-etat.pid, 'SIGTERM');
    } catch {
      // Déjà arrêté.
    }
    await writeFile(
      join(dossier, 'etat.json'),
      JSON.stringify({ ...etat, etape: 'annule', detail: 'Arrêté depuis l’app', fin: Date.now() / 1000 }),
    );
    return this.lire(id);
  }

  async lire(id: string): Promise<LancementSumo> {
    const dossier = this.dossier(id);
    const [etat, parametres] = await Promise.all([
      this.lireEtat(dossier),
      readFile(join(dossier, 'parametres.json'), 'utf8').then((t) => JSON.parse(t) as LancerEssaiSumo),
    ]);
    // Lanceur disparu en cours de route (redémarrage de la machine, processus tué).
    const demarrage = etat.pid === 0 && Date.now() / 1000 - etat.debut < DELAI_DEMARRAGE;
    if (ETAPES_ACTIVES.includes(etat.etape) && !demarrage && !vivant(etat.pid)) {
      etat.detail = `Lanceur arrêté pendant l’étape « ${etat.etape} » (machine redémarrée ?)`;
      etat.etape = 'erreur';
    }
    const progression = etat.etape === 'simulation' || etat.etape === 'archivage' ? await this.dernierPas(dossier) : null;
    const maintenant = Date.now() / 1000;
    const ecoule = (etat.fin ?? maintenant) - etat.debut;
    return {
      id,
      nom: parametres.nom,
      etape: etat.etape,
      detail: etat.detail,
      debut: etat.debut * 1000,
      fin: etat.fin ? etat.fin * 1000 : null,
      ecoule,
      debutSimule: etat.debutSimule ?? null,
      finSimulee: etat.finSimulee ?? null,
      progression,
      restant: this.restant(etat, progression, maintenant),
      essaiId: etat.essaiId ?? null,
      journal: etat.journal ?? null,
    };
  }

  /** Durée restante, au prorata de l'heure simulée (la pointe du matin est plus lente que la nuit). */
  private restant(etat: EtatFichier, progression: LancementSumo['progression'], maintenant: number): number | null {
    if (etat.etape !== 'simulation' || !progression || etat.debutSimule === undefined || etat.finSimulee === undefined) {
      return null;
    }
    const fait = (progression.temps - etat.debutSimule) / (etat.finSimulee - etat.debutSimule);
    if (fait <= 0.02) return null;
    const ecoule = maintenant - (etat.debutEtape ?? etat.debut);
    return Math.max(0, (ecoule / fait) * (1 - fait));
  }

  private async lireEtat(dossier: string): Promise<EtatFichier> {
    try {
      return JSON.parse(await readFile(join(dossier, 'etat.json'), 'utf8')) as EtatFichier;
    } catch {
      throw new NotFoundException('Lancement introuvable');
    }
  }

  /** Dernier `<step …/>` de summary.xml, écrit par SUMO à chaque seconde simulée. */
  private async dernierPas(dossier: string): Promise<LancementSumo['progression']> {
    let fichier;
    try {
      fichier = await open(join(dossier, 'sorties', 'summary.xml'), 'r');
    } catch {
      return null;
    }
    try {
      const { size } = await fichier.stat();
      const tampon = Buffer.alloc(Math.min(size, FIN_SUMMARY));
      await fichier.read(tampon, 0, tampon.length, size - tampon.length);
      const pas = [...tampon.toString('utf8').matchAll(/<step ([^>]*)\/>/g)].at(-1)?.[1];
      if (!pas) return null;
      const attr = (nom: string) => Number(new RegExp(`\\b${nom}="([^"]*)"`).exec(pas)?.[1] ?? 0);
      return {
        temps: attr('time'),
        charges: attr('loaded'),
        inseres: attr('inserted'),
        enRoute: attr('running'),
        aLArret: attr('halting'),
        arrives: attr('arrived'),
        teleportations: attr('teleports'),
        vitesse: Math.round(Math.max(0, attr('meanSpeed')) * 36) / 10,
      };
    } finally {
      await fichier.close();
    }
  }

  /** Options modifiables seulement, avec une valeur du bon type. */
  private async verifierOptions(options: Record<string, string>): Promise<void> {
    const connues = new Map((await this.options()).categories.flatMap((c) => c.options).map((o) => [o.cle, o]));
    const erreurs: string[] = [];
    for (const [cle, valeur] of Object.entries(options)) {
      const option = connues.get(cle);
      if (!option) erreurs.push(`${cle} : option inconnue`);
      else if (!option.modifiable) erreurs.push(`${cle} : réglée par le lanceur`);
      else if (option.type === 'BOOL' && !['true', 'false'].includes(valeur)) erreurs.push(`${cle} : true ou false`);
      else if (option.type === 'INT' && !/^-?\d+$/.test(valeur)) erreurs.push(`${cle} : nombre entier attendu`);
      else if ((option.type === 'FLOAT' || option.type === 'TIME') && !/^-?\d+(\.\d+)?$/.test(valeur)) {
        erreurs.push(`${cle} : nombre attendu`);
      }
    }
    if (erreurs.length) throw new BadRequestException({ message: 'Options de SUMO invalides', erreurs });
  }
}
