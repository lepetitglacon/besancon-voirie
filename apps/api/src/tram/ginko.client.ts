import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { strFromU8, unzipSync } from 'fflate';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import type { FichiersGtfs } from './gtfs.js';
import type { CourseTempsReel, FluxTempsReel } from './temps-reel.js';

const { transit_realtime } = GtfsRealtimeBindings;
const COURSE_SUPPRIMEE = transit_realtime.TripDescriptor.ScheduleRelationship.CANCELED;
const ARRET_NON_DESSERVI = transit_realtime.TripUpdate.StopTimeUpdate.ScheduleRelationship.SKIPPED;

/** Open data Ginko (Keolis Besançon Mobilités), licence ODbL. */
const API_GINKO = 'https://api.ginko.voyage';
const FICHIERS_UTILES = ['routes.txt', 'trips.txt', 'stop_times.txt', 'stops.txt', 'shapes.txt', 'feed_info.txt'];

@Injectable()
export class GinkoClient {
  constructor(private readonly config: ConfigService) {}

  /** GTFS statique, régénéré chaque nuit par Ginko. Public, sans clé. */
  async telechargerGtfs(): Promise<FichiersGtfs> {
    const archive = await this.telecharger(`${API_GINKO}/gtfs-ginko.zip`, 60_000);
    const fichiers = unzipSync(archive, { filter: ({ name }) => FICHIERS_UTILES.includes(name) });
    return Object.fromEntries(Object.entries(fichiers).map(([nom, octets]) => [nom, strFromU8(octets)]));
  }

  /** Flux GTFS-RT `tripUpdates` : prévisions de passage de toutes les courses en cours ou à venir. */
  async lireTempsReel(): Promise<FluxTempsReel> {
    const cle = this.config.get<string>('GINKO_API_KEY');
    if (!cle) throw new ServiceUnavailableException('Clé API Ginko absente (GINKO_API_KEY dans le .env)');
    const octets = await this.telecharger(
      `${API_GINKO}/GTFSRT/tripUpdates.do?apiKey=${encodeURIComponent(cle)}`,
      15_000,
    );
    return decoderTripUpdates(octets);
  }

  private async telecharger(url: string, delai_ms: number): Promise<Uint8Array> {
    let reponse: Response;
    try {
      reponse = await fetch(url, { signal: AbortSignal.timeout(delai_ms) });
    } catch (erreur) {
      throw new ServiceUnavailableException(`Ginko injoignable : ${(erreur as Error).message}`);
    }
    if (!reponse.ok) {
      // L'URL porte la clé : on ne la recopie pas dans le message.
      throw new ServiceUnavailableException(`Ginko a répondu HTTP ${reponse.status}`);
    }
    return new Uint8Array(await reponse.arrayBuffer());
  }
}

export function decoderTripUpdates(octets: Uint8Array): FluxTempsReel {
  const message = transit_realtime.FeedMessage.decode(octets);
  const courses: CourseTempsReel[] = [];
  for (const { tripUpdate } of message.entity) {
    const course = tripUpdate?.trip.tripId;
    if (!tripUpdate || !course || tripUpdate.trip.scheduleRelationship === COURSE_SUPPRIMEE) continue;
    const arrets = (tripUpdate.stopTimeUpdate ?? [])
      .filter((passage) => passage.scheduleRelationship !== ARRET_NON_DESSERVI)
      .map((passage) => {
        const arrivee = Number(passage.arrival?.time ?? passage.departure?.time ?? 0);
        const depart = Number(passage.departure?.time ?? passage.arrival?.time ?? 0);
        return { sequence: passage.stopSequence ?? -1, arret: passage.stopId ?? '', arrivee, depart };
      })
      .filter((passage) => passage.arrivee > 0 && passage.arret && passage.sequence >= 0)
      .sort((a, b) => a.sequence - b.sequence);
    courses.push({ course, vehicule: tripUpdate.vehicle?.id ?? undefined, arrets });
  }
  return { horodatage: Number(message.header.timestamp ?? 0), courses };
}
