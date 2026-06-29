// Verified compound-word links: each pair [a, b] means "a + b" is a real closed
// compound word (e.g. ["snow","ball"] → snowball). Chains are built by walking a
// path through this directed graph, so EVERY adjacent pair in a generated chain is
// a real compound by construction — and chains can be as long as the graph allows.
//
// Connector words (ball, house, work, out, side, way, back, ground, light, board,
// down, up, water, head, hand, paper, line, time, land, sea, ...) appear as both a
// suffix and a prefix, which is what lets the walk keep going.
//
// (Phase 4 will replace this hand-curated list with an offline-generated, validated
// pack — see CLAUDE.md §8. For now this list is the content.)
export const LINKS: ReadonlyArray<readonly [string, string]> = [
  // snow / sun / rain / fire / water / moon / star / day
  ['snow', 'ball'], ['snow', 'man'], ['snow', 'flake'], ['snow', 'storm'], ['snow', 'board'], ['snow', 'fall'], ['snow', 'plow'], ['snow', 'shoe'],
  ['sun', 'flower'], ['sun', 'shine'], ['sun', 'light'], ['sun', 'burn'], ['sun', 'set'], ['sun', 'rise'], ['sun', 'down'], ['sun', 'spot'],
  ['rain', 'bow'], ['rain', 'coat'], ['rain', 'drop'], ['rain', 'fall'], ['rain', 'storm'], ['rain', 'water'],
  ['fire', 'ball'], ['fire', 'fly'], ['fire', 'work'], ['fire', 'place'], ['fire', 'wood'], ['fire', 'house'], ['fire', 'side'], ['fire', 'proof'], ['fire', 'arm'],
  ['water', 'fall'], ['water', 'mark'], ['water', 'melon'], ['water', 'proof'], ['water', 'way'], ['water', 'front'], ['water', 'color'], ['water', 'shed'],
  ['moon', 'light'], ['moon', 'shine'], ['moon', 'beam'], ['moon', 'walk'],
  ['star', 'fish'], ['star', 'light'], ['star', 'dust'], ['star', 'board'], ['star', 'gazer'],
  ['day', 'light'], ['day', 'dream'], ['day', 'break'], ['day', 'time'], ['day', 'care'], ['day', 'bed'],

  // ball / room / house / work / out / side / walk / way
  ['ball', 'room'], ['ball', 'park'], ['ball', 'game'], ['ball', 'point'],
  ['room', 'mate'],
  ['house', 'hold'], ['house', 'work'], ['house', 'wife'], ['house', 'boat'], ['house', 'fly'], ['house', 'plant'], ['house', 'top'], ['house', 'coat'], ['house', 'keeper'],
  ['work', 'shop'], ['work', 'out'], ['work', 'place'], ['work', 'load'], ['work', 'bench'], ['work', 'day'], ['work', 'man'], ['work', 'book'], ['work', 'horse'], ['work', 'force'], ['work', 'flow'],
  ['out', 'side'], ['out', 'look'], ['out', 'let'], ['out', 'come'], ['out', 'fit'], ['out', 'break'], ['out', 'law'], ['out', 'line'], ['out', 'back'], ['out', 'burst'], ['out', 'cast'], ['out', 'door'], ['out', 'house'], ['out', 'post'], ['out', 'right'], ['out', 'grow'], ['out', 'number'],
  ['side', 'walk'], ['side', 'line'], ['side', 'show'], ['side', 'kick'], ['side', 'step'], ['side', 'bar'], ['side', 'car'], ['side', 'board'], ['side', 'ways'], ['side', 'track'],
  ['walk', 'way'], ['walk', 'out'],
  ['way', 'side'], ['way', 'ward'],

  // back / ground / up / down / town / hall
  ['back', 'bone'], ['back', 'ground'], ['back', 'pack'], ['back', 'fire'], ['back', 'yard'], ['back', 'drop'], ['back', 'lash'], ['back', 'stage'], ['back', 'hand'], ['back', 'board'], ['back', 'log'], ['back', 'side'], ['back', 'track'], ['back', 'water'], ['back', 'room'], ['back', 'field'], ['back', 'stroke'], ['back', 'space'], ['back', 'stop'],
  ['ground', 'work'], ['ground', 'hog'], ['ground', 'water'],
  ['up', 'side'], ['up', 'set'], ['up', 'grade'], ['up', 'load'], ['up', 'town'], ['up', 'stairs'], ['up', 'hill'], ['up', 'keep'], ['up', 'lift'], ['up', 'right'], ['up', 'start'], ['up', 'stream'], ['up', 'beat'], ['up', 'turn'], ['up', 'root'], ['up', 'land'], ['up', 'hold'],
  ['down', 'town'], ['down', 'load'], ['down', 'fall'], ['down', 'stairs'], ['down', 'hill'], ['down', 'pour'], ['down', 'size'], ['down', 'grade'], ['down', 'stream'], ['down', 'beat'], ['down', 'cast'], ['down', 'side'], ['down', 'time'], ['down', 'turn'], ['down', 'wind'], ['down', 'right'],
  ['town', 'ship'], ['town', 'house'],
  ['hall', 'way'], ['hall', 'mark'],

  // light / board / key / paper / news / fly / wheel
  ['light', 'house'], ['light', 'weight'],
  ['board', 'walk'], ['board', 'room'],
  ['key', 'board'], ['key', 'hole'], ['key', 'note'], ['key', 'pad'], ['key', 'stone'], ['key', 'word'], ['key', 'chain'],
  ['paper', 'back'], ['paper', 'weight'], ['paper', 'work'], ['paper', 'boy'], ['paper', 'clip'],
  ['news', 'paper'], ['news', 'cast'], ['news', 'stand'], ['news', 'letter'], ['news', 'room'], ['news', 'reel'],
  ['fly', 'paper'], ['fly', 'wheel'],
  ['wheel', 'chair'], ['wheel', 'barrow'], ['wheel', 'house'],

  // head / hand / foot / eye / finger
  ['head', 'light'], ['head', 'ache'], ['head', 'band'], ['head', 'board'], ['head', 'count'], ['head', 'first'], ['head', 'gear'], ['head', 'line'], ['head', 'lock'], ['head', 'phone'], ['head', 'rest'], ['head', 'room'], ['head', 'set'], ['head', 'stand'], ['head', 'stone'], ['head', 'strong'], ['head', 'way'], ['head', 'wind'], ['head', 'master'],
  ['hand', 'bag'], ['hand', 'ball'], ['hand', 'book'], ['hand', 'cuff'], ['hand', 'gun'], ['hand', 'made'], ['hand', 'out'], ['hand', 'rail'], ['hand', 'shake'], ['hand', 'stand'], ['hand', 'writing'], ['hand', 'saw'], ['hand', 'pick'], ['hand', 'hold'], ['hand', 'brake'],
  ['foot', 'ball'], ['foot', 'hill'], ['foot', 'hold'], ['foot', 'note'], ['foot', 'print'], ['foot', 'step'], ['foot', 'stool'], ['foot', 'wear'], ['foot', 'work'], ['foot', 'bridge'], ['foot', 'path'], ['foot', 'rest'], ['foot', 'board'],
  ['eye', 'ball'], ['eye', 'brow'], ['eye', 'lash'], ['eye', 'lid'], ['eye', 'sight'], ['eye', 'witness'],
  ['finger', 'print'], ['finger', 'nail'], ['finger', 'tip'],

  // bath / bird / black / bed / cow / boy / friend / ship
  ['bath', 'room'], ['bath', 'tub'], ['bath', 'robe'], ['bath', 'house'],
  ['bird', 'bath'], ['bird', 'house'], ['bird', 'seed'], ['bird', 'cage'],
  ['black', 'bird'], ['black', 'board'], ['black', 'berry'], ['black', 'out'], ['black', 'smith'], ['black', 'list'], ['black', 'mail'], ['black', 'top'],
  ['bed', 'room'], ['bed', 'time'], ['bed', 'bug'], ['bed', 'rock'], ['bed', 'side'], ['bed', 'spread'], ['bed', 'roll'], ['bed', 'pan'],
  ['cow', 'boy'], ['cow', 'girl'], ['cow', 'hand'], ['cow', 'hide'], ['cow', 'bell'], ['cow', 'shed'],
  ['boy', 'friend'], ['boy', 'hood'],
  ['friend', 'ship'],
  ['ship', 'yard'], ['ship', 'wreck'], ['ship', 'mate'], ['ship', 'load'], ['ship', 'board'], ['ship', 'builder'],

  // fall / bone / yard / honey / butter
  ['fall', 'out'],
  ['bone', 'yard'], ['bone', 'fish'],
  ['yard', 'stick'], ['yard', 'work'],
  ['honey', 'moon'], ['honey', 'comb'], ['honey', 'bee'], ['honey', 'dew'], ['honey', 'suckle'],
  ['butter', 'fly'], ['butter', 'milk'], ['butter', 'cup'], ['butter', 'scotch'],

  // rail / road / race / horse / shoe / play / sea / shore
  ['rail', 'road'], ['rail', 'way'],
  ['road', 'way'], ['road', 'side'], ['road', 'block'], ['road', 'map'], ['road', 'house'], ['road', 'work'], ['road', 'bed'], ['road', 'runner'],
  ['race', 'track'], ['race', 'horse'], ['race', 'way'], ['race', 'car'],
  ['horse', 'back'], ['horse', 'shoe'], ['horse', 'fly'], ['horse', 'power'], ['horse', 'man'], ['horse', 'play'], ['horse', 'radish'],
  ['shoe', 'lace'], ['shoe', 'horn'], ['shoe', 'string'], ['shoe', 'maker'],
  ['play', 'ground'], ['play', 'house'], ['play', 'pen'], ['play', 'mate'], ['play', 'room'], ['play', 'wright'], ['play', 'off'], ['play', 'back'], ['play', 'book'], ['play', 'boy'], ['play', 'time'], ['play', 'thing'],
  ['sea', 'food'], ['sea', 'shore'], ['sea', 'shell'], ['sea', 'side'], ['sea', 'weed'], ['sea', 'front'], ['sea', 'port'], ['sea', 'sick'], ['sea', 'horse'], ['sea', 'board'], ['sea', 'coast'], ['sea', 'plane'], ['sea', 'scape'], ['sea', 'way'],
  ['shore', 'line'],

  // under / over / time / line / land / wood / book / store / class / grand
  ['under', 'ground'], ['under', 'line'], ['under', 'dog'], ['under', 'cover'], ['under', 'cut'], ['under', 'pass'], ['under', 'water'], ['under', 'wear'], ['under', 'world'], ['under', 'hand'], ['under', 'tow'], ['under', 'go'],
  ['over', 'board'], ['over', 'coat'], ['over', 'flow'], ['over', 'head'], ['over', 'load'], ['over', 'night'], ['over', 'pass'], ['over', 'time'], ['over', 'turn'], ['over', 'weight'], ['over', 'work'], ['over', 'grow'], ['over', 'hang'], ['over', 'look'], ['over', 'hear'],
  ['time', 'line'], ['time', 'table'], ['time', 'keeper'], ['time', 'piece'], ['time', 'frame'], ['time', 'card'],
  ['line', 'up'], ['line', 'man'], ['line', 'backer'],
  ['land', 'scape'], ['land', 'mark'], ['land', 'slide'], ['land', 'lord'], ['land', 'fill'], ['land', 'line'], ['land', 'lady'], ['land', 'mass'], ['land', 'owner'], ['land', 'form'],
  ['wood', 'land'], ['wood', 'work'], ['wood', 'pecker'], ['wood', 'wind'], ['wood', 'pile'], ['wood', 'shed'], ['wood', 'cut'],
  ['book', 'case'], ['book', 'end'], ['book', 'keeper'], ['book', 'mark'], ['book', 'shelf'], ['book', 'store'], ['book', 'worm'], ['book', 'maker'],
  ['store', 'house'], ['store', 'room'], ['store', 'front'], ['store', 'keeper'],
  ['class', 'room'], ['class', 'mate'], ['class', 'work'],
  ['grand', 'father'], ['grand', 'mother'], ['grand', 'parent'], ['grand', 'child'], ['grand', 'stand'], ['grand', 'son'],
  ['father', 'hood'], ['father', 'land'],
  ['mother', 'hood'], ['mother', 'land'],
  ['post', 'card'], ['post', 'man'], ['post', 'mark'], ['post', 'script'], ['post', 'war'],
  ['card', 'board'],
];
