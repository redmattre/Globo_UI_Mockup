## Punti Critici Emersi
### Mega slider
- Transizione da uno all'altro con parametro globale
- Se teniamo slider sarebbe meglio riordinarli
### Stereo
- Ce ne sbattiamo all'inizio
- Macro comportamento pulsante
### Salto nel cerchio
- Inteporlazione doppio oggetto
### Gradi rappresentazione
- 0 e 360 sono la stessa cosa 360 fai modulo
### 3D per altezza 
- Altezza doppio range
- Visualizzazione tridimensionale con handle
### Speaker Backup
- Tasto che lokka gli algoritmi ai gradi dove ci sono gli speaker, puoi scegliere se tipo il random non va in punti a caso ma in punti dove ho gli speaker. Anche la traversa va da speaker a speaker.
## Sviluppo

- Stilare architettura a moduli RNBO/GEN
	- Gen: algoritmi di spazializzazione di rendering
	- RNBO: Controllo
- Modulo scrittura memoria condivisa parametri
	- Altoparlanti
	- Parametri Spats
	- Generali
- Moduli di spazializzazione
	- Parametri condivisi tra tutti
	- Spazializzazione specifica
		- VBAP
		- DBAP
		- DIRECT
		- Ambi
nota: Tempo di salita X tempo di spegnimento X * 1.5 (coefficiente). (Rampsmooth). Questa cosa comunque deve essere equal power 1/sqrt(g1^2+g2^2)
