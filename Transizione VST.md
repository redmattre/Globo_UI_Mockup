## Cose da tenere in conto

- fare una prova scrivendo un oggetto param e mettendo un param dentro al codebox ed esportare il codice C++. A quel punto vedere se si confondono i due a livello di codice o se non viene considerato quello dentro al codebox. Questo può essere un problema nel momento di linkare la UI ai parametri
	- soluzione 1: chiamare i parametri dentro al codebox diversamente dai parametri oggetto
	- soluzione 2: fare tutto con input output del codebox (sconsigliatissimo, sono tantissimi parametri)
- Recuperare dai test di linkaggio quale fosse il problema di click relativi a linkare elementi UI ai parametri RNBO
- Gestire esternamente (con logica C++) la questione relativa allo spegnimento accendimento dei vari algoritmi (oppure più solido ma più accrocchio gestirla già dentro RNBO)