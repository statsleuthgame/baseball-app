// Actual MLB fence dimensions from MLB API (hydrate=fieldInfo)
// venueId → { LF, LCF, CF, RCF, RF } in feet
const FENCE_DIMENSIONS = {
  680:  { LF: 331, LCF: 390, CF: 405, RCF: 387, RF: 327 }, // T-Mobile Park
  4705: { LF: 335, LCF: 385, CF: 400, RCF: 375, RF: 325 }, // Truist Park
  15:   { LF: 328, LCF: 412, CF: 407, RCF: 414, RF: 335 }, // Chase Field
  2:    { LF: 333, LCF: 376, CF: 410, RCF: 373, RF: 318 }, // Camden Yards
  3:    { LF: 310, LCF: 390, CF: 420, RCF: 380, RF: 302 }, // Fenway Park
  17:   { LF: 355, LCF: 368, CF: 400, RCF: 368, RF: 353 }, // Wrigley Field
  4:    { LF: 330, LCF: 377, CF: 400, RCF: 372, RF: 335 }, // Guaranteed Rate
  2602: { LF: 328, LCF: 379, CF: 404, RCF: 370, RF: 325 }, // Great American
  5:    { LF: 325, LCF: 410, CF: 405, RCF: 375, RF: 325 }, // Progressive Field
  19:   { LF: 347, LCF: 420, CF: 415, RCF: 424, RF: 350 }, // Coors Field
  2394: { LF: 345, LCF: 370, CF: 420, RCF: 365, RF: 330 }, // Comerica Park
  2392: { LF: 315, LCF: 362, CF: 409, RCF: 373, RF: 326 }, // Minute Maid
  7:    { LF: 347, LCF: 379, CF: 410, RCF: 379, RF: 344 }, // Kauffman Stadium
  1:    { LF: 330, LCF: 389, CF: 396, RCF: 365, RF: 330 }, // Angel Stadium
  22:   { LF: 330, LCF: 385, CF: 395, RCF: 385, RF: 330 }, // Dodger Stadium
  4169: { LF: 344, LCF: 386, CF: 407, RCF: 392, RF: 335 }, // LoanDepot Park
  32:   { LF: 344, LCF: 371, CF: 400, RCF: 374, RF: 345 }, // American Family
  3312: { LF: 339, LCF: 377, CF: 404, RCF: 367, RF: 328 }, // Target Field
  3289: { LF: 335, LCF: 370, CF: 408, RCF: 380, RF: 330 }, // Citi Field
  3313: { LF: 318, LCF: 399, CF: 408, RCF: 385, RF: 314 }, // Yankee Stadium
  10:   { LF: 330, LCF: 388, CF: 400, RCF: 388, RF: 330 }, // Oakland Coliseum
  2681: { LF: 329, LCF: 381, CF: 401, RCF: 398, RF: 330 }, // Citizens Bank
  31:   { LF: 325, LCF: 410, CF: 399, RCF: 375, RF: 320 }, // PNC Park
  2680: { LF: 336, LCF: 386, CF: 396, RCF: 391, RF: 322 }, // Petco Park
  2395: { LF: 339, LCF: 399, CF: 391, RCF: 415, RF: 309 }, // Oracle Park
  2889: { LF: 336, LCF: 375, CF: 400, RCF: 375, RF: 335 }, // Busch Stadium
  12:   { LF: 315, LCF: 410, CF: 404, RCF: 404, RF: 322 }, // Tropicana
  5325: { LF: 329, LCF: 372, CF: 407, RCF: 374, RF: 326 }, // Globe Life Field
  14:   { LF: 328, LCF: 375, CF: 404, RCF: 375, RF: 328 }, // Rogers Centre
  3309: { LF: 336, LCF: 377, CF: 402, RCF: 370, RF: 335 }, // Nationals Park
};

export default FENCE_DIMENSIONS;
