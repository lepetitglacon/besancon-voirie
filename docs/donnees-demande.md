# Données pour la demande SUMO

> **Objectif** : recenser les données ouvertes qui disent où les Bisontins habitent, où ils vont
> et par où entrent ceux qui viennent d'ailleurs, pour remplacer les poids actuels de la demande.
> **Statut** : brouillon
> **Dernière mise à jour** : 2026-10-14

## Contexte

La demande de la ville est tirée par [demande.py](../data/sumo/ville/demande.py) :
`randomTrips.py --weights-prefix poids` avec, pour chaque rue, un poids
« longueur × facteur du type de voie » ([types-demande.txt](../data/sumo/ville/types-demande.txt)).
Les départs sont répartis à 30 % sur les entrées de ville et à 70 % en ville ; les arrivées à
15 % vers les sorties et à 85 % en ville. Les entrées se répartissent selon la classe de l'axe,
pas selon un trafic mesuré. [deplacements.py](../data/sumo/ville/deplacements.py) en déduit la
journée : retour du soir, sorties du midi, flux choisis.

Ce document liste les données disponibles. Le choix de ce qu'on intègre vient ensuite.

Trois besoins :

1. **Départs** (pointe du matin) : où habitent les gens.
2. **Arrivées** : où sont les emplois, les écoles et les commerces.
3. **Entrées de ville** : combien de véhicules arrivent de l'extérieur, par quelle route, à quelle
   heure. Ces chiffres varient peu d'une semaine à l'autre et peuvent être figés dans un fichier.

## Synthèse

| Besoin | Meilleure source | Finesse | Ouverte | Millésime |
|---|---|---|---|---|
| Domiciles | INSEE Filosofi carroyé | carré de 200 m | oui | 2021 |
| Domiciles (plus fin) | BD TOPO / BDNB : logements par bâtiment | bâtiment | oui | annuel |
| Emplois | Sirene géolocalisé + tranche d'effectif | établissement | oui | mensuel |
| Écoles, commerces, santé | INSEE BPE géolocalisée | équipement | oui | 2025 |
| Zones d'activité (qualitatif) | OSM `landuse`, zonage du PLU | polygone | oui | continu |
| Qui vient d'où (commune → commune) | INSEE MOBPRO et MOBSCO | commune | oui | 2022 |
| Volumes aux entrées | Comptages du Doubs (routes départementales), TMJA des routes nationales | section de route | oui | 2007 → 2023 |
| Déplacements détaillés (heure, motif) | Enquête ménages-déplacements 2018 | zone de l'enquête | **non** (sur demande) | 2018 |
| Comptages en ville | aucune donnée ouverte trouvée | — | — | — |

## 1. Où habitent les gens

### INSEE Filosofi, données carroyées à 200 m

- Population par tranche d'âge, ménages, logements (dont individuels et collectifs) et revenus
  pour chaque carré habité de 200 m de côté.
- Le dernier millésime porte sur 2021 et a été publié en février 2026. Formats : CSV,
  GeoPackage, shapefile.
- Un carré de moins de 11 ménages fiscaux a des valeurs imputées (`i_est_200 = 1`) : la
  population reste juste en ordre de grandeur.
- Usage : nombre de ménages ou de personnes de 25 à 64 ans par carré, réparti sur les rues
  résidentielles du carré au prorata de leur longueur. C'est le poids `src` du matin.
- [Page INSEE, carreaux de 200 m (2021)](https://www.insee.fr/fr/statistiques/8735162)
  · [documentation](https://www.insee.fr/fr/statistiques/fichier/8735106/documentation_donnees-carroyees_filosofi2021.pdf)

### IGN BD TOPO, bâtiments

- Chaque bâtiment avec son usage principal (résidentiel, commercial, industriel,
  enseignement…), sa hauteur et son nombre de logements pour le résidentiel.
- Gratuite sous Licence Ouverte Etalab 2.0 depuis 2021. Téléchargement par département (Doubs,
  25) sur le site géoservices de l'IGN.
- Plus fine que Filosofi, mais elle ne donne pas le nombre d'habitants : les logements servent
  d'approximation. Elle couvre aussi les arrivées (surface des bâtiments d'activité).

> ❓ **À confirmer** : le nom exact des attributs (`usage_1`, `nombre_de_logements`) dans la
> version en cours. Je ne l'ai pas vérifié ; la description du produit sur
> [geoservices.ign.fr](https://geoservices.ign.fr/bdtopo) fait foi.

### BDNB (Base de données nationale des bâtiments, CSTB)

- Croise la BD TOPO avec d'autres sources (fichiers fonciers notamment) : un enregistrement par
  bâtiment, avec usage et nombre de logements.
- Ouverte. C'est une alternative à la BD TOPO si le nombre de logements y manque.

### Le cadastre

- Le cadastre Etalab (parcelles et bâti, sur `cadastre.data.gouv.fr`) est ouvert, mais **ne dit
  pas à quoi sert un local**. Seul, il ne sert pas pour la demande.
- Le détail des locaux (fichiers fonciers du Cerema, MAJIC) est réservé aux ayants droit
  (collectivités, bureaux d'études sous convention). Non accessible pour ce projet.

## 2. Où vont les gens

### Sirene géolocalisé (INSEE)

- Tous les établissements actifs avec leurs coordonnées (X, Y) et leur IRIS. Fichier mensuel ;
  le CSV doit disparaître au second semestre 2027, au profit du seul Parquet.
- La **tranche d'effectif salarié** n'est pas dans le fichier de géolocalisation : elle est dans
  le stock des établissements Sirene, à joindre par SIRET.
- Pièges : les tranches sont larges (par exemple 10-19, 50-99, 2 000-4 999) et souvent non
  renseignées pour les petites structures. Les gros employeurs publics (CHU, université,
  collectivités) peuvent être géolocalisés à leur siège : à corriger à la main (voir
  « Pôles à saisir » ci-dessous).
- Usage : emplois par rue, comme poids `dst` du matin.
- [Géolocalisation des établissements Sirene](https://www.data.gouv.fr/datasets/61d5e2d372a52d9f9411ff88)

### Base permanente des équipements (BPE, INSEE)

- Écoles, collèges, lycées, enseignement supérieur, commerces (hypermarchés, supermarchés…),
  santé, sport, administrations, chacun géolocalisé (WGS84 depuis 2023).
- Millésime 2025, paru en juillet 2026. CSV ou Parquet. Seul le dernier millésime reste
  téléchargeable.
- Usage : destinations « école » à 8 h, « commerce » en fin de journée et le samedi.
- [Équipements géolocalisés en 2025](https://www.insee.fr/fr/statistiques/8217525)

### OSM et zonage du PLU

- OSM `landuse=residential|industrial|commercial|retail` : polygones qualitatifs, déjà à portée de
  l'import Overpass du projet ([import-osm.ts](../apps/api/src/osm/import-osm.ts)). Utile pour
  dessiner les zones d'activité, pas pour les chiffrer.
- Zonage du PLU (Géoportail de l'urbanisme) : zones U, AU, et zones dédiées aux activités. Même
  usage, de source officielle.

### Pôles à saisir à la main

Quelques générateurs pèsent plus que ce que Sirene en dit et méritent une entrée explicite :
CHU Minjoz, campus de la Bouloie et Temis, centre-ville, Châteaufarine, Valentin, Micropolis,
gare Viotte.

## 3. Qui vient d'où : les entrées de ville

### INSEE MOBPRO : déplacements domicile-travail

- Pour chaque couple « commune de résidence → commune de travail », le nombre d'actifs.
- La **base de flux** donne les effectifs agrégés, sans le mode de transport. Le **fichier
  détail** donne un individu par ligne, avec son mode de transport (`TRANS`) : c'est lui qui
  permet de ne garder que les voitures.
- Dernier millésime : recensement 2022 (géographie au 1er janvier 2025).
- Les flux de moins de 200 personnes sont des ordres de grandeur, à cause du sondage.
- Usage : actifs résidant hors de Besançon et travaillant à Besançon en voiture, par commune.
  Chaque commune est rattachée à son entrée de ville : RN57 nord et sud, D673, D683, D70,
  D571, etc. Ces poids remplacent les poids par classe d'axe de `demande.py`.
- [Base de flux 2022](https://www.insee.fr/fr/statistiques/8582949)
  · [documentation](https://www.insee.fr/fr/information/2383337)

### INSEE MOBSCO : déplacements domicile-études

- Même chose pour les élèves et étudiants. Millésime 2022.
- Utile pour la pointe de 8 h, qui mêle travail et école ; une part des élèves vient en bus
  ou est déposée en voiture.
- [Base de flux 2022](https://www.insee.fr/fr/statistiques/8582969)

### Comptages du Département du Doubs (routes départementales)

- 3 953 lignes, de 2007 à 2023, dernière mise à jour en janvier 2023. CSV et JSON, licence ODbL.
- Colonnes : route, PR + abscisse, localisation en texte, année, TMJA tous véhicules et poids
  lourds, **trafic par sens**, dates de pose du compteur.
- **Aucune coordonnée** : il faut placer chaque point à la main d'après la localisation (« Entre
  giratoire D75 (Pirey) et giratoire N57 (Besançon) »). Pour une douzaine d'entrées, c'est
  rapide.
- Ce sont des moyennes journalières annuelles, sans profil horaire. L'heure de pointe compte
  usuellement pour 8 à 10 % du TMJA, à caler.
- Exemples de comptages sur le territoire de Besançon (agence BES), années récentes :

  | Route | Section | Année | TMJA 2 sens |
  |---|---|---|---|
  | D673 (ex-RN273) | Châteaufarine Est → Micropolis | 2023 | 55 063 |
  | D673 | Franois → Châteaufarine Est | 2023 | 32 264 |
  | D572 | Bd Léon Blum → N57 (rue de Vesoul) | 2023 | 21 012 |
  | D673 | Saint-Vit-Colas → Franois | 2023 | 19 487 |
  | D67 | Autoroute D67A → D75/D673 (Franois) | 2023 | 16 869 |
  | D70 | D75 (Pirey) → N57 | 2023 | 14 340 |
  | D683 | D413 (Besançon) → Thise | 2023 | 14 138 |
  | D571 | Tunnel de Rivotte → N57 (Morre) | 2019 | 13 410 |

- [Jeu « Comptages » sur data.gouv](https://www.data.gouv.fr/datasets/comptages)
  · [source : opendata.doubs.fr](https://opendata.doubs.fr/explore/dataset/comptages/)

### TMJA du réseau routier national

- Jeu du Ministère de la Transition écologique : TMJA et part de poids lourds par section de route
  nationale, avec coordonnées de début et de fin. Dernière mise à jour en août 2025.
- Pour Besançon : RN57 (nord vers Vesoul, sud vers Pontarlier) et RN83.
- La DIR Est publie aussi un « observatoire des trafics » annuel en PDF (2024), par station.
- [TMJA du réseau routier national](https://www.data.gouv.fr/fr/datasets/trafic-moyen-journalier-annuel-sur-le-reseau-routier-national/)

> ❓ **À confirmer** : le millésime le plus récent du fichier national, et si les stations autour
> de Besançon y figurent avec leur sens. Le PDF de la DIR Est n'a pas pu être lu (accès refusé
> à l'outil).

### Ce qu'il faudra figer dans un fichier

Avec MOBPRO et les comptages, un fichier versionné par entrée de ville suffit :
`{ entree, arete_sumo, communes, vehicules_heure: { "7": …, "8": …, … } }`, éventuellement
avec un profil par jour de la semaine. Les communes donnent la répartition entre entrées ; les
comptages donnent le volume ; le profil horaire est supposé jusqu'à ce qu'on trouve mieux.

## 4. Déplacements détaillés : l'enquête ménages-déplacements 2018

- Enquête du Grand Besançon (avec le SCoT et l'État), d'octobre 2017 à mars 2018, sur
  114 à 118 communes selon les sources : environ 3 500 personnes interrogées sur leurs
  déplacements de la veille (origine, destination, heure, motif, mode). Elle succède à
  l'enquête de 2005.
- C'est la seule source qui donne une matrice origine-destination à l'intérieur de la ville,
  avec les heures. Les résultats agrégés sont cités par le Cerema et l'agence d'urbanisme
  (3,8 déplacements par personne et par jour en 2018, contre 4,5 en 2005).
- **Pas en open data.** La base peut se demander au Grand Besançon ou à l'agence d'urbanisme
  Besançon Centre Franche-Comté (AUDAB), sous convention.
- [Article macommune.info](https://www.macommune.info/comment-se-deplacent-les-habitants-de-la-region-de-besancon-169367)
  · [analyse du Cerema](https://cerema.fr/fr/print/pdf/node/7826)

## 5. Ce qui n'existe pas (ou pas en ouvert)

- **Comptages routiers en ville** : le portail [data.grandbesancon.fr](https://data.grandbesancon.fr/)
  n'en publie pas (sa rubrique Transport-Mobilité couvre Ginko, VéloCité, Citiz, IRVE,
  covoiturage). Pas de comptage vélo ouvert trouvé non plus.
- **Telraam** : aucun capteur repéré à Besançon. Ce serait un moyen citoyen d'avoir des comptages
  horaires sur quelques rues.
- **Données de téléphonie** (Orange Flux Vision, etc.) et traces GPS commerciales : payantes.

## 6. À côté : transports en commun

- GTFS et SIRI du réseau Ginko (bus, tram, tracés des lignes), mis à jour en juin 2026. Il ne
  couvre ni le scolaire ni le transport à la demande. Utile pour mettre les bus et le tram dans
  SUMO, pas pour la demande automobile.
- [GTFS Ginko](https://www.data.gouv.fr/datasets/gtfs-et-siri-du-reseau-ginko-besancon-lignes-urbaines-et-periurbaines)

## Pièges & précisions

- Si les flux INSEE et les comptages ne concordent pas → c'est normal : MOBPRO compte des
  personnes qui vont travailler (un aller), les comptages comptent tous les véhicules, tous motifs
  confondus, dans les deux sens et à toute heure. MOBPRO donne la **répartition** entre entrées,
  les comptages le **volume**.
- Si un comptage du Doubs est ancien (avant 2019) → préférer le plus récent sur la même section ;
  2020 et 2021 sont faussés par le Covid.
- Si des voitures sont placées sur un carré Filosofi sans rue résidentielle → reporter le poids sur
  la rue la plus proche plutôt que de le perdre.

## Journal

- 2026-10-14 — création : inventaire des sources pour les domiciles, les emplois, les entrées de
  ville et les origines-destinations.
