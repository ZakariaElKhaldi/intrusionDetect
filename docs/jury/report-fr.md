# Rapport de projet d'été — Détection d'intrusions IoT par flux réseau

> Version soutenance. Les valeurs numériques définitives doivent être reprises directement de `models/production/evaluation-report.json` et `docs/evidence/replay-benchmark.json` après la dernière promotion des modèles. Ne jamais remplacer un résultat manquant par une estimation.

## Résumé

Ce projet réalise un prototype reproductible de détection d'intrusions pour des flux réseau compatibles avec le schéma RT-IoT2022. Le système valide chaque observation, applique une cascade de deux modèles — détection binaire puis classification de la famille d'attaque —, persiste les décisions et les alertes, diffuse les événements en temps réel et permet leur investigation dans une interface web. La démonstration rejoue un jeu de données enregistré; elle ne capture pas du trafic réseau en direct.

## 1. Problématique et objectifs

Les objets connectés produisent des communications nombreuses, hétérogènes et souvent difficiles à superviser. L'objectif est de vérifier si une chaîne de traitement relativement légère peut distinguer le trafic normal des attaques connues, caractériser les attaques détectées et fournir à l'analyste des éléments interprétables. Le projet vise une preuve de concept académique, non un produit de sécurité certifié.

Les objectifs vérifiables sont: provenance des données, absence de fuite entre partitions, comparaison de plusieurs familles de modèles, évaluation complète de la cascade, service d'inférence persistant, rejeu contrôlable et démonstration reproductible.

## 2. État de l'art

Le contexte scientifique, les sources primaires et leur date de vérification sont consignés dans [`../research-foundations.md`](../research-foundations.md). Le projet distingue clairement la détection binaire, la classification multiclasse, l'explicabilité locale et la validation opérationnelle. Les scores issus d'une partition aléatoire d'un seul jeu de données ne constituent pas une validation de déploiement.

## 3. Données et audit de provenance

La source est RT-IoT2022, distribuée par UCI sous licence CC BY 4.0. L'archive et le CSV préparé sont contrôlés par SHA-256. Le fichier observé contient 123 117 lignes, 83 variables de modèle et 12 libellés: trois libellés normaux et neuf familles d'attaque.

Une divergence vérifiée existe entre certaines descriptions textuelles d'UCI et le fichier distribué: le texte mentionne notamment Amazon Alexa et présente des comptes de classes incompatibles, alors que le CSV vérifié contient `MQTT_Publish`, `Thing_Speak` et `Wipro_bulb` comme trafic normal. Le fichier identifié par son empreinte est donc la source expérimentale de vérité. Les doublons de vecteurs de caractéristiques sont retirés avant la partition afin qu'un même flux ne traverse pas les ensembles.

## 4. Méthodologie

La chaîne comprend:

1. validation du schéma et de l'ordre des 83 caractéristiques;
2. déduplication avant partition;
3. partition commune stratifiée selon les 12 libellés originaux;
4. apprentissage du détecteur binaire sur toutes les lignes d'apprentissage;
5. apprentissage du classifieur de familles uniquement sur les attaques du même ensemble d'apprentissage;
6. sélection de candidats sur la validation, sur trois graines déclarées;
7. mesure finale sur le test commun, jamais utilisé pour la sélection;
8. promotion atomique des champions avec métadonnées et empreintes.

Cette partition commune empêche le classifieur de voir pendant son entraînement une attaque qui appartient au test de la cascade. Les graines, tailles et empreintes des partitions doivent apparaître dans le rapport d'évaluation généré.

## 5. Modèles candidats et politique de sélection

Quatre familles scikit-learn sont comparées séparément pour chaque tâche: régression logistique, arbre de décision, forêt aléatoire et gradient boosting sur histogrammes. Le champion est choisi selon la métrique déclarée sur validation; le test ne sert pas à choisir. Les probabilités exposées par `predict_proba` sont des scores non calibrés. Le seuil du détecteur reste celui documenté tant qu'une analyse validation précision/rappel/FPR/taux d'alerte ne justifie pas une autre politique.

## 6. Résultats

Les résultats définitifs sont générés, et non recopiés manuellement:

- candidats et agrégats sur trois graines: `GET /evaluation?stage=binary|multiclass`;
- matrices de confusion, supports et métriques test: `models/production/evaluation-report.json`;
- cascade complète à dix classes, faux négatifs du détecteur, rappel par famille et macro-F1: section cascade du même rapport;
- rejeu normal/attaque, débit et latences p50/p95: [`../evidence/replay-benchmark.md`](../evidence/replay-benchmark.md).

L'interprétation doit privilégier les rappels des classes rares et les erreurs de routage du détecteur. Une bonne moyenne globale peut masquer une famille peu représentée.

## 7. Architecture et fonctionnement

FastAPI charge exclusivement le bundle promu et vérifié, applique la cascade, puis écrit observation, prédiction et éventuelle alerte dans SQLite ou PostgreSQL. Chaque prédiction est diffusée par WebSocket; seules les observations déclarées « attaque » créent une alerte. React fournit les vues de supervision, rejeu, alertes, topologie et analyse des modèles. Les explications SHAP sont calculées à la demande pour une alerte et restent séparées des règles de sévérité et des preuves brutes.

## 8. Validation de bout en bout

Le test Playwright démarre un backend réel avec les modèles promus, un frontend réel et une base SQLite temporaire. Il vérifie l'absence de fixtures dans une base neuve, le rejeu normal sans alerte, le rejeu d'attaque avec versions des deux modèles, le cycle pause/reprise/arrêt et la persistance du retour analyste. `make jury-preflight` exécute les validations de données, d'artefacts, de code, de construction et de navigateur.

## 9. Limites, éthique et menaces à la validité

- La partition est aléatoire et interne à un seul jeu de données; aucun champ fiable ne permet une séparation temporelle, par session ou par appareil.
- L'ordre du CSV est un ordre de rejeu, pas une chronologie réseau démontrée.
- Les scores ne sont pas calibrés et SHAP explique le comportement du modèle, sans prouver une cause.
- Les classes rares augmentent l'incertitude des métriques par famille.
- Le schéma ne fournit pas toujours une identité IP persistante; les ports ne doivent pas être présentés comme des appareils.
- Un détecteur peut produire des faux positifs et faux négatifs. Il assiste l'analyste et ne doit pas déclencher seul une réponse destructive.
- Les données de sécurité peuvent être sensibles; toute utilisation réelle demanderait contrôle d'accès, rétention limitée et audit.

## 10. Conclusion et travaux futurs

Le résultat défendable est une chaîne de recherche et de démonstration reproductible sur données enregistrées. Les travaux futurs sont la capture live, un extracteur PCAP validé, la détection de dérive, les politiques MUD/appareil, le déploiement edge, l'authentification, une file distribuée et la montée en charge. Ils sont volontairement exclus de la soutenance car chacun exige un protocole de validation propre.

## Reproductibilité

```bash
make setup
make prepare-data
make jury-preflight
make demo
```

Les résultats ne doivent être régénérés qu'après une promotion intentionnelle des modèles avec `make benchmark`. Le script de démonstration crée une base jetable et n'entraîne jamais de modèle.
