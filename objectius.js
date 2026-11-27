// Objectius de la temporada 2027. Per afegir-ne, copia el bloc de l'Oriol amb un altre nom.
// tipus: "birdies"  = birdies en una sola volta
//        "sota_par" = nombre de voltes individuals sota par (amb "marge": -5 compta les voltes de -5 o millor, és a dir 49 cops o menys)
//        "ranquing" = posició a Competicions Oficials de pitch.cat ("seccio" = nom de l'apartat), objectiu = posició màxima
//        "parelles" = millor volta de parelles respecte al par (p. ex. -10)
//        "hcp"      = arribar a aquest handicap
//        "voltes"   = nombre de torneigs jugats
window.PB_OBJECTIUS_ANY = "2027";
window.PB_OBJECTIUS = {
  "Oriol": [
    { "tipus": "birdies", "objectiu": 7, "text": "7 birdies en una volta" },
    { "tipus": "sota_par", "objectiu": 15, "text": "15 voltes sota par" },
    { "tipus": "parelles", "objectiu": -10, "text": "Volta en parelles de -10" }
  ],
  "Gery": [
    { "tipus": "sota_par", "objectiu": 3, "marge": -5, "text": "3 voltes de -5 individual" },
    { "tipus": "ranquing", "objectiu": 80, "seccio": "Millor Jugador de l'Any", "text": "Quedar dins el top 80 del rànquing individual" },
    { "tipus": "birdies", "objectiu": 10, "text": "10 birdies en una partida" }
  ]
};
