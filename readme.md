# Calcium – Extension Chrome

Extension Chrome de monitoring et scraping JSON-LD pour les jeux/apps utilisant une API Hydra/JSON-LD. Intercepte les requêtes `fetch` et `XHR` sortantes de la page pour capturer et afficher les réponses JSON en temps réel et spécialisée sur RoA.

***

## Prérequis

- Google Chrome (ou Chromium) version 88+
- Git installé sur votre machine
- Aucune dépendance npm — l'extension est en vanilla JS

***

## Installation en mode développeur

### 1. Cloner le dépôt

```bash
git clone https://github.com/RoAScript/Script.git
cd Script
```

ou Télécharger le ZIP du dépôt GitHub et décompresser le fichier.
https://github.com/RoAScript/Script/archive/refs/heads/main.zip

### 2. Ouvrir la page Extensions de Chrome

Naviguez vers l'URL suivante dans Chrome :

```
chrome://extensions
```

### 3. Activer le mode développeur

En haut à droite de la page, activez le toggle **"Mode développeur"** (Developer mode).

### 4. Charger l'extension non empaquetée

Cliquez sur **"Charger l'extension non empaquetée"** (Load unpacked), puis sélectionnez le dossier racine du dépôt cloné (celui qui contient le fichier `manifest.json`).

L'extension apparaît alors dans la liste avec son icône.

***

### 5. Afficher le paneau latéral

Pour afficher les informations, cliquer sur l'icone "C" à droite de la barre d'adresse, celle-ci peut être accessible via le bouton "Puzzle".

***

## Mise à jour après un `git pull`

Après avoir tiré des modifications depuis le dépôt :

```bash
git pull origin main
```

Retournez sur `chrome://extensions` et cliquez sur l'icône **↺ (Recharger)** sur la carte de l'extension, ou appuyez sur le bouton **"Mettre à jour"** en haut de la page. Il n'est pas nécessaire de recharger l'extension non empaquetée depuis zéro, sauf si le `manifest.json` a changé.

***

## Désinstallation

Sur `chrome://extensions`, cliquez sur **"Supprimer"** sur la carte de l'extension Calcium.

***

## Disclaimer

**L'extension ne fait qu'afficher les requêtes échangées et ne modifie pas les requêtes.**

