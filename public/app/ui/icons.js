// One inline SVG icon set, drawn for this game: 24x24 grid, 1.6 stroke, round joins, currentColor.
// Classes inside a glyph: .f = solid fill, .d = dim fill (22%).

const P = {
  // ---- action bar
  character: '<path class="d" d="M5 12.5V10a7 7 0 0 1 14 0v2.500l-4 1.500H9z"/><path d="M5 12.500V10a7 7 0 0 1 14 0v2.500"/><path d="M5 12.500v6l4 2V14h6v6.500l4-2v-6"/><path d="M12 3v7.500M9.500 14h5"/>',
  bags: '<path class="d" d="M7.500 9C5 11 3.800 13.800 3.800 16.400c0 3 2.400 4.100 8.200 4.100s8.200-1.100 8.200-4.100c0-2.600-1.200-5.400-3.700-7.400z"/><path d="M7.500 9C5 11 3.800 13.800 3.800 16.400c0 3 2.400 4.100 8.200 4.100s8.200-1.100 8.200-4.100c0-2.600-1.200-5.400-3.700-7.400"/><path d="M8 9h8"/><path d="M8.600 9 7.400 4.600c1.600.9 3 .9 4.600 0 1.600.9 3 .9 4.600 0L15.400 9"/><circle class="f" cx="12" cy="14.600" r="1.300"/>',
  quests: '<path class="d" d="M19 17V5.500a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2V17z"/><path d="M19 17V5.500a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2V17"/><path d="M3.500 17h17v1a2.500 2.500 0 0 1-2.500 2.500H6A2.500 2.500 0 0 1 3.500 18z"/><path d="M12 7v4.800"/><circle class="f" cx="12" cy="14.200" r="1"/>',
  map: '<circle cx="12" cy="12" r="8.800"/><path class="f" d="M12 5.200 14.300 12H9.700z"/><path d="M9.700 12 12 18.800 14.300 12"/><path d="M5.300 12h1.900M16.800 12h1.900"/>',
  treasury: '<ellipse class="d" cx="12" cy="7" rx="7" ry="3"/><ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v4c0 1.700 3.100 3 7 3s7-1.300 7-3V7"/><path d="M5 11v4c0 1.700 3.100 3 7 3s7-1.300 7-3v-4"/>',
  party: '<circle cx="9" cy="8.500" r="3"/><path class="d" d="M3 19.500c.4-3.600 2.800-5.800 6-5.800s5.600 2.200 6 5.800z"/><path d="M3 19.500c.4-3.600 2.800-5.800 6-5.800s5.600 2.200 6 5.800"/><circle cx="16.700" cy="7.300" r="2.400"/><path d="M16.400 12.200c2.700 0 4.500 1.900 4.900 5"/>',
  needs: '<path class="d" d="M8.700 9.500h6.600L12 3.500z"/><path d="M12 3.500 21 20H3z"/><path d="M8.700 9.500h6.600M5.900 14.800h12.200"/>',
  signals: '<circle class="f" cx="12" cy="12" r="1.700"/><path d="M8.600 15.400a4.800 4.800 0 0 1 0-6.800M15.400 8.600a4.800 4.800 0 0 1 0 6.800M5.800 18.200a8.800 8.800 0 0 1 0-12.400M18.200 5.800a8.800 8.800 0 0 1 0 12.400"/>',

  // ---- vitals
  heart: '<path class="d" d="M12 20.300 4.600 12.900a4.700 4.700 0 0 1 6.600-6.600l.8.8.8-.8a4.700 4.700 0 0 1 6.600 6.600z"/><path d="M12 20.300 4.600 12.900a4.700 4.700 0 0 1 6.600-6.600l.8.8.8-.8a4.700 4.700 0 0 1 6.600 6.600z"/>',
  bolt: '<path class="d" d="M13.200 2.800 5.500 13.400h5.600l-1 7.800 8.400-11.200h-5.900z"/><path d="M13.200 2.800 5.500 13.400h5.600l-1 7.800 8.400-11.200h-5.900z"/>',
  boot: '<path class="d" d="M8 3.500h6v9l5.200 2.600a2.500 2.500 0 0 1 1.300 2.200v2.200H8z"/><path d="M8 3.500h6v9l5.200 2.600a2.500 2.500 0 0 1 1.300 2.200v2.200H8z"/><path d="M8 16.800h12.300M8 7h3"/>',
  flame: '<path d="M12 21c-3.800 0-6.500-2.600-6.500-6.300 0-2.500 1.400-4.300 2.900-6.100.4 1.500 1.100 2.400 2.100 2.900C10.300 8.200 11.500 5.200 14 3c.3 3.200 4.500 6 4.500 11.500 0 3.800-2.700 6.500-6.500 6.500z"/><path class="d" d="M12 21c-1.700 0-2.800-1.200-2.800-2.800 0-1.500 1.100-2.500 2.800-4.200 1.700 1.700 2.800 2.700 2.800 4.200 0 1.600-1.100 2.800-2.800 2.800z"/>',
  eye: '<path d="M2.500 12S6 5.800 12 5.800 21.500 12 21.500 12 18 18.200 12 18.200 2.500 12 2.500 12z"/><circle class="d" cx="12" cy="12" r="2.900"/><circle cx="12" cy="12" r="2.900"/>',
  coin: '<circle class="d" cx="12" cy="12" r="8.600"/><circle cx="12" cy="12" r="8.600"/><path d="M12 7.300 15.100 12 12 16.700 8.900 12z"/>',
  xp: '<path class="d" d="M12 3.200 14.600 9l6.200.6-4.700 4.200 1.400 6.200L12 16.800 6.500 20l1.400-6.200L3.200 9.600 9.400 9z"/><path d="M12 3.200 14.600 9l6.200.6-4.700 4.200 1.400 6.200L12 16.800 6.500 20l1.400-6.200L3.200 9.600 9.400 9z"/>',
  drop: '<path class="d" d="M12 3.200c3.200 4 5.800 6.900 5.800 10.300a5.800 5.800 0 0 1-11.600 0c0-3.400 2.600-6.300 5.800-10.300z"/><path d="M12 3.200c3.200 4 5.800 6.900 5.800 10.300a5.800 5.800 0 0 1-11.600 0c0-3.400 2.600-6.300 5.800-10.300z"/>',
  pulse: '<path d="M2.500 12.500h4l2-5.500 3.500 11 2.500-8 1.500 2.500h5.500"/>',

  // ---- buffs / debuffs
  moon: '<path class="d" d="M19.500 14.200A8 8 0 0 1 9.800 4.500a8 8 0 1 0 9.700 9.700z"/><path d="M19.500 14.200A8 8 0 0 1 9.800 4.500a8 8 0 1 0 9.700 9.700z"/>',
  sun: '<circle class="d" cx="12" cy="12" r="3.900"/><circle cx="12" cy="12" r="3.900"/><path d="M12 2.800v2.400M12 18.800v2.400M2.800 12h2.400M18.800 12h2.400M5.500 5.500l1.700 1.700M16.800 16.800l1.700 1.700M5.500 18.500l1.700-1.700M16.800 7.200l1.700-1.700"/>',
  dumbbell: '<path d="M8 12h8M2.300 10.500v3M21.700 10.500v3"/><rect class="d" x="4" y="7.500" width="4" height="9" rx="1.200"/><rect x="4" y="7.500" width="4" height="9" rx="1.200"/><rect class="d" x="16" y="7.500" width="4" height="9" rx="1.200"/><rect x="16" y="7.500" width="4" height="9" rx="1.200"/>',
  leaf: '<path class="d" d="M5 19c0-9 5-14 15-14 0 10-5 15-14 14.500z"/><path d="M5 19c0-9 5-14 15-14 0 10-5 15-14 14.500"/><path d="M4 20.500c3-5.500 6.500-8.500 11-11"/>',
  brain: '<path d="M12 5.500v13M12 5.500A3 3 0 0 0 6.300 6.800 3.200 3.200 0 0 0 4.500 12a3.200 3.200 0 0 0 1.800 5.200A3 3 0 0 0 12 18.500M12 5.500a3 3 0 0 1 5.700 1.300A3.200 3.200 0 0 1 19.500 12a3.200 3.200 0 0 1-1.800 5.200A3 3 0 0 1 12 18.500"/><path d="M8.300 10.300c1.100.2 1.900.9 2.100 2M15.700 13.700c-1.100-.2-1.900-.9-2.100-2"/>',
  skull: '<path class="d" d="M5 11a7 7 0 0 1 14 0c0 2.300-1 4-2.500 5v3.500h-9V16C6 15 5 13.300 5 11z"/><path d="M5 11a7 7 0 0 1 14 0c0 2.300-1 4-2.500 5v3.500h-9V16C6 15 5 13.300 5 11z"/><circle class="f" cx="9.300" cy="11.500" r="1.500"/><circle class="f" cx="14.700" cy="11.500" r="1.500"/><path d="M10.500 19.500v-2M13.500 19.500v-2"/>',
  hourglass: '<path d="M6.500 3.500h11M6.500 20.500h11M7.500 3.500c0 4 4.500 5 4.500 8.500s-4.500 4.500-4.500 8.500M16.500 3.500c0 4-4.500 5-4.500 8.500s4.500 4.500 4.500 8.500"/><path class="d" d="M9 18.500c.6-1.500 1.800-2.300 3-3.500 1.200 1.200 2.400 2 3 3.500z"/>',
  shield: '<path class="d" d="M12 3 19.500 5.800v5.700c0 4.500-3 7.800-7.500 9.500-4.500-1.700-7.500-5-7.500-9.500V5.800z"/><path d="M12 3 19.500 5.800v5.700c0 4.500-3 7.800-7.500 9.500-4.500-1.700-7.500-5-7.500-9.500V5.800z"/>',
  coffee: '<path class="d" d="M5 9h11v5.500a4.500 4.500 0 0 1-4.500 4.500h-2A4.500 4.500 0 0 1 5 14.500z"/><path d="M5 9h11v5.500a4.500 4.500 0 0 1-4.500 4.500h-2A4.500 4.500 0 0 1 5 14.500z"/><path d="M16 10.500h1.500a2.300 2.300 0 0 1 0 4.600H16M8.500 3.500c-.8 1 .8 2 0 3M12 3.500c-.8 1 .8 2 0 3"/>',
  warning: '<path class="d" d="M12 3.800 21 19.500H3z"/><path d="M12 3.800 21 19.500H3z"/><path d="M12 9.500v5"/><circle class="f" cx="12" cy="17" r=".9"/>',
  screen: '<rect class="d" x="3" y="4.500" width="18" height="12" rx="1.500"/><rect x="3" y="4.500" width="18" height="12" rx="1.500"/><path d="M9 20.500h6M12 16.500v4"/>',
  star: '<path class="d" d="M12 3.200 14.600 9l6.200.6-4.700 4.200 1.400 6.200L12 16.800 6.500 20l1.400-6.200L3.200 9.600 9.400 9z"/><path d="M12 3.200 14.600 9l6.200.6-4.700 4.200 1.400 6.200L12 16.800 6.500 20l1.400-6.200L3.200 9.600 9.400 9z"/>',

  // ---- log / event types
  check: '<path d="M5 12.500 10 17.500 19.500 7"/>',
  plane: '<path class="d" d="M21 3l-6.500 18-4-7.500L3 9.500z"/><path d="M21 3 10.500 13.500M21 3l-6.500 18-4-7.500L3 9.500z"/>',
  chip: '<rect x="6.500" y="6.500" width="11" height="11" rx="1.500"/><rect class="d" x="9.700" y="9.700" width="4.600" height="4.600"/><path d="M9.500 3.500v3M14.500 3.500v3M9.500 17.500v3M14.500 17.500v3M3.500 9.500h3M3.500 14.500h3M17.500 9.500h3M17.500 14.500h3"/>',
  bowl: '<path class="d" d="M3.500 11h17a8.500 8.500 0 0 1-17 0z"/><path d="M3.500 11h17a8.500 8.500 0 0 1-17 0z"/><path d="M8.500 21h7M9 7.500c-.8-1 .8-2 0-3M13 7.500c-.8-1 .8-2 0-3"/>',
  scale: '<rect class="d" x="4" y="4" width="16" height="16" rx="3"/><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M7.500 10.500a6 6 0 0 1 9 0M12 11.500l2-3.200"/>',
  levelup: '<path d="M5.500 12.500 12 6l6.500 6.500M5.500 18.500 12 12l6.500 6.500"/>',
  crown: '<path class="d" d="M4 8l4 4.500L12 6l4 6.500L20 8l-1.500 10h-13z"/><path d="M4 8l4 4.500L12 6l4 6.500L20 8l-1.500 10h-13z"/>',

  // ---- equipment slots and item categories
  head: '<path class="d" d="M5 14.500a7 7 0 0 1 14 0z"/><path d="M5 14.500a7 7 0 0 1 14 0"/><rect x="2.800" y="14.500" width="18.400" height="2.800" rx="1.400"/>',
  chest: '<path class="d" d="M8.500 3.500 3 6.500l2 4.500 2.500-1v10.500h9V10l2.500 1 2-4.500-5.500-3a3.500 3.500 0 0 1-7 0z"/><path d="M8.500 3.500 3 6.500l2 4.500 2.500-1v10.500h9V10l2.500 1 2-4.500-5.500-3a3.500 3.500 0 0 1-7 0z"/>',
  legs: '<path class="d" d="M6.500 3.500h11l1 17h-5L12 9l-1.500 11.500h-5z"/><path d="M6.500 3.500h11l1 17h-5L12 9l-1.500 11.500h-5zM6.300 6.500h11.400"/>',
  feet: '<path class="d" d="M3 16.500V9.500c2 0 3.500 1 4.500 2.500l3 .8 6 1.500c2.500.5 4.500 1.500 4.500 3.700V19H3z"/><path d="M3 16.500V9.500c2 0 3.500 1 4.500 2.500l3 .8 6 1.500c2.500.5 4.500 1.500 4.500 3.700V19H3zM3 16.300h18"/>',
  wrist: '<rect class="d" x="7" y="7" width="10" height="10" rx="2.500"/><rect x="7" y="7" width="10" height="10" rx="2.500"/><path d="M9 7 9.800 3h4.400l.8 4M9 17l.8 4h4.400l.8-4M12 10v2.300l1.500 1"/>',
  finger: '<circle cx="12" cy="14.500" r="5.800"/><path class="d" d="M9.500 6 12 3.200 14.500 6 12 8.700z"/><path d="M9.500 6 12 3.200 14.500 6 12 8.700z"/>',
  back: '<path class="d" d="M6 9.500a6 6 0 0 1 12 0v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path d="M6 9.500a6 6 0 0 1 12 0v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path d="M9.500 4V3h5v1M9 13.500h6V17H9zM4 12v5M20 12v5"/>',
  neck: '<path d="M5 4c0 6 3 9.500 7 9.500S19 10 19 4"/><path class="d" d="M12 13.500 14.200 16.800 12 20l-2.200-3.200z"/><path d="M12 13.500 14.200 16.800 12 20l-2.200-3.200z"/>',
  mainhand: '<path class="d" d="M20.200 3.800 16.700 5.100 7.900 13.900 10.100 16.100 18.900 7.300z"/><path d="M20.200 3.800 16.700 5.100 7.900 13.900 10.100 16.100 18.900 7.300z"/><path d="M6 12l6 6M8 16l-3 3"/><circle class="f" cx="4.300" cy="19.700" r="1.200"/>',
  offhand: '<path class="d" d="M5 4.500h11a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3z"/><path d="M5 4.500h11a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3z"/><path d="M5 16.500a3 3 0 0 1 3-3h11M12 7v3.400M10.300 8.700h3.400"/>',
  trinket: '<path class="d" d="M7 4.500h10l4 5.500-9 10L3 10z"/><path d="M7 4.500h10l4 5.500-9 10L3 10z"/><path d="M3 10h18M9.500 10 12 20l2.500-10M7 4.500 9.500 10 12 4.500 14.500 10 17 4.500"/>',
  phone: '<rect class="d" x="7" y="2.800" width="10" height="18.400" rx="2.200"/><rect x="7" y="2.800" width="10" height="18.400" rx="2.200"/><path d="M10.500 5.500h3"/>',
  laptop: '<path class="d" d="M5 5.500h14V15H5z"/><path d="M5 5.500h14V15H5z"/><path d="M2.500 18.500h19L20 15H4z"/>',
  headphones: '<path d="M4.500 14.500V12a7.500 7.500 0 0 1 15 0v2.500"/><rect class="d" x="3.500" y="13.500" width="4" height="6.500" rx="1.500"/><rect x="3.500" y="13.500" width="4" height="6.500" rx="1.500"/><rect class="d" x="16.500" y="13.500" width="4" height="6.500" rx="1.500"/><rect x="16.500" y="13.500" width="4" height="6.500" rx="1.500"/>',
  camera: '<path class="d" d="M3.500 8H7l1.500-2.500h7L17 8h3.500v11h-17z"/><path d="M3.500 8H7l1.500-2.500h7L17 8h3.500v11h-17z"/><circle cx="12" cy="13.200" r="3.300"/>',
  glasses: '<circle class="d" cx="7" cy="13.500" r="3.500"/><circle cx="7" cy="13.500" r="3.500"/><circle class="d" cx="17" cy="13.500" r="3.500"/><circle cx="17" cy="13.500" r="3.500"/><path d="M10.500 13.500c.8-1 2.200-1 3 0M3.500 13 5 7.500M20.500 13 19 7.500"/>',
  key: '<circle cx="8" cy="15.500" r="4.200"/><path d="M11 12.500 20 3.500M16.500 7l2.500 2.500M14 9.500l1.800 1.800"/>',
  bottle: '<path class="d" d="M8 13h8v6a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2z"/><path d="M10 2.800h4V6l2 3v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V9l2-3zM8 13h8"/>',
  box: '<path class="d" d="M3.500 7.500 12 12v9l-8.500-4.500z"/><path d="M12 3 20.500 7.500v9L12 21 3.500 16.500v-9z"/><path d="M3.500 7.500 12 12l8.500-4.500M12 12v9"/>',
  doc: '<path class="d" d="M6 3h8.500L18.500 7v14H6z"/><path d="M6 3h8.500L18.500 7v14H6z"/><path d="M14.500 3v4h4M9 12h6M9 15.500h6"/>',
  tool: '<path d="M14.700 6.300a4.200 4.200 0 0 0-5.400 5.400L3.500 17.500l3 3 5.800-5.800a4.200 4.200 0 0 0 5.400-5.400l-2.700 2.700-2.300-.7-.7-2.300z"/>',
  keypad: '<rect class="d" x="4" y="4" width="16" height="16" rx="2.500"/><rect x="4" y="4" width="16" height="16" rx="2.500"/><path d="M9.300 4v16M14.700 4v16M4 9.300h16M4 14.700h16"/>',
  card: '<rect class="d" x="3" y="5.500" width="18" height="13" rx="2"/><rect x="3" y="5.500" width="18" height="13" rx="2"/><path d="M3 10h18M6.500 14.500h4"/>',
  board: '<path class="d" d="M12 2.500c3.500 4 4.500 8 4.500 11.500 0 3-1.500 5.500-4.500 7.500-3-2-4.500-4.500-4.500-7.500 0-3.500 1-7.500 4.500-11.500z"/><path d="M12 2.500c3.500 4 4.500 8 4.500 11.500 0 3-1.500 5.500-4.500 7.500-3-2-4.500-4.500-4.500-7.500 0-3.500 1-7.500 4.500-11.500zM12 6.500v11"/>',

  vehicle: '<path class="d" d="M3 15.500v-3l2.200-5.500h13.600L21 12.500v3z"/><path d="M3 15.500v-3l2.200-5.500h13.600L21 12.500v3zM3 12.500h18M5 15.500V18h3v-2.500M16 15.500V18h3v-2.500"/>',
  gear: '<circle cx="12" cy="12" r="6.400"/><circle class="d" cx="12" cy="12" r="2.800"/><circle cx="12" cy="12" r="2.800"/><path d="M12 2.600v3M12 18.400v3M2.600 12h3M18.400 12h3M5.400 5.400l2.100 2.100M16.500 16.500l2.100 2.100M5.400 18.600l2.100-2.100M16.500 7.500l2.100-2.100"/>',

  chronicle: '<rect class="d" x="3.500" y="5" width="17" height="15.500" rx="2"/><rect x="3.500" y="5" width="17" height="15.500" rx="2"/><path d="M3.500 9.500h17M8 3v4M16 3v4"/><path class="f" d="M7 12h2.400v2.400H7zM10.800 12h2.400v2.400h-2.400zM14.600 15.600H17V18h-2.400z"/>',
  quill: '<path class="d" d="M20 4C13 4 8 8 7 16c4 0 7-1 9-4 2.500-1.500 4-4 4-8z"/><path d="M20 4C13 4 8 8 7 16l-2.500 4.500M7 16c4 0 7-1 9-4M20 4c0 4-1.500 6.500-4 8"/>',
  search: '<circle cx="10.500" cy="10.500" r="6"/><path d="M15 15l5.500 5.500"/>',
  question: '<path d="M8.500 9a3.500 3.500 0 1 1 5.300 3c-1.200.8-1.800 1.500-1.800 3"/><circle class="f" cx="12" cy="18.500" r="1.100"/>',

  // ---- attributes (the ten areas)
  rook: '<path class="d" d="M7 12V5h2.300v2H11V5h2v2h1.700V5H17v7z"/><path d="M6.500 20.500h11M8.500 20.500l.8-8.500h5.400l.8 8.500M7 12V5h2.300v2H11V5h2v2h1.700V5H17v7z"/>',
  sparkle: '<path class="d" d="M12 3.500c.6 4.500 2 6 6.500 6.500-4.500.6-5.900 2-6.500 6.500-.6-4.500-2-5.900-6.500-6.500 4.500-.5 5.900-2 6.500-6.500z"/><path d="M12 3.500c.6 4.500 2 6 6.500 6.500-4.500.6-5.900 2-6.500 6.500-.6-4.500-2-5.900-6.500-6.500 4.500-.5 5.900-2 6.500-6.500zM18.500 16.500v4M16.500 18.500h4"/>',
  link: '<path d="M10 14a4.200 4.200 0 0 0 6 0l3-3a4.200 4.200 0 0 0-6-6l-1 1"/><path d="M14 10a4.200 4.200 0 0 0-6 0l-3 3a4.200 4.200 0 0 0 6 6l1-1"/>',
  sprout: '<path d="M12 20.500v-9"/><path class="d" d="M12 13.500C12 9.500 9.500 7 5 7c0 4.500 2.500 6.500 7 6.500z"/><path d="M12 13.500C12 9.500 9.500 7 5 7c0 4.500 2.500 6.500 7 6.500z"/><path class="d" d="M12 11c0-3.500 2.500-6 7-6 0 4-2.500 6-7 6z"/><path d="M12 11c0-3.500 2.500-6 7-6 0 4-2.500 6-7 6z"/>',
  target: '<circle cx="12" cy="12" r="8.600"/><circle class="d" cx="12" cy="12" r="4.800"/><circle cx="12" cy="12" r="4.800"/><circle class="f" cx="12" cy="12" r="1.400"/>',
  person: '<circle cx="12" cy="8" r="3.500"/><path class="d" d="M4.800 20.400c.5-4.300 3.400-6.900 7.200-6.900s6.700 2.600 7.200 6.900z"/><path d="M4.800 20.400c.5-4.300 3.400-6.900 7.200-6.900s6.700 2.600 7.200 6.900"/>',

  // ---- roster kinds
  sigil: '<path class="d" d="M12 2.800 21.200 12 12 21.200 2.800 12z"/><path d="M12 2.800 21.200 12 12 21.200 2.800 12z"/><circle cx="12" cy="12" r="3.100"/><circle class="f" cx="12" cy="12" r="1.100"/>',
  banner: '<path class="d" d="M6 3.500h12v15l-6-3.500-6 3.500z"/><path d="M6 3.500h12v15l-6-3.500-6 3.500zM4 3.500h16"/><path d="M12 7l1.600 2.600L12 12.200l-1.600-2.600z"/>',
  server: '<rect class="d" x="4" y="4.500" width="16" height="6" rx="1.500"/><rect x="4" y="4.500" width="16" height="6" rx="1.500"/><rect class="d" x="4" y="13.500" width="16" height="6" rx="1.500"/><rect x="4" y="13.500" width="16" height="6" rx="1.500"/><circle class="f" cx="7.500" cy="7.500" r=".9"/><circle class="f" cx="7.500" cy="16.500" r=".9"/>',

  // ---- places
  home: '<path class="d" d="M6 10v10h12V10l-6-5.300z"/><path d="M3.500 11.500 12 4l8.500 7.500M6 10v10h12V10M10 20v-5.500h4V20"/>',
  city: '<path d="M3.500 20.500h17M5.500 20.500V9l5-2.500v14M10.500 20.500V4.500l8 3v13M13.500 10.500h2M13.500 14h2"/>',
  flag: '<path class="d" d="M5.500 4.500c5-2.500 7 2.500 13 0v9c-6 2.500-8-2.500-13 0z"/><path d="M5.500 21V3.500M5.500 4.500c5-2.500 7 2.500 13 0v9c-6 2.500-8-2.500-13 0"/>',
  globe: '<circle cx="12" cy="12" r="8.700"/><path d="M3.300 12h17.400M12 3.300c-5.500 5-5.500 12.400 0 17.400M12 3.300c5.500 5 5.500 12.400 0 17.400"/>',
  pin: '<path class="d" d="M12 21s-6.500-6.200-6.500-11a6.500 6.500 0 0 1 13 0c0 4.800-6.500 11-6.500 11z"/><path d="M12 21s-6.500-6.200-6.500-11a6.500 6.500 0 0 1 13 0c0 4.800-6.500 11-6.500 11z"/><circle cx="12" cy="10" r="2.300"/>',

  // ---- weather (WMO codes map onto these)
  cloud: '<path class="d" d="M7 18.500a4 4 0 0 1-.5-8 5.500 5.500 0 0 1 10.600-1.300A4.700 4.700 0 0 1 17 18.500z"/><path d="M7 18.500a4 4 0 0 1-.5-8 5.500 5.500 0 0 1 10.600-1.300A4.700 4.700 0 0 1 17 18.500z"/>',
  partly: '<circle cx="8" cy="8" r="2.800"/><path d="M8 2.500V4M2.500 8H4M4.100 4.100l1.100 1.100M11.900 4.100l-1.100 1.100"/><path class="d" d="M9.500 19.500a3.500 3.500 0 0 1-.3-7 4.800 4.800 0 0 1 9.200-1 4 4 0 0 1-.4 8z"/><path d="M9.500 19.500a3.500 3.500 0 0 1-.3-7 4.800 4.800 0 0 1 9.200-1 4 4 0 0 1-.4 8z"/>',
  rain: '<path class="d" d="M7 15a4 4 0 0 1-.5-8 5.500 5.500 0 0 1 10.600-1.300A4.700 4.700 0 0 1 17 15z"/><path d="M7 15a4 4 0 0 1-.5-8 5.500 5.500 0 0 1 10.600-1.300A4.700 4.700 0 0 1 17 15zM8.500 18l-1 2.500M12.500 18l-1 2.500M16.500 18l-1 2.500"/>',
  storm: '<path class="d" d="M7 15a4 4 0 0 1-.5-8 5.500 5.500 0 0 1 10.600-1.300A4.700 4.700 0 0 1 17 15z"/><path d="M7 15a4 4 0 0 1-.5-8 5.500 5.500 0 0 1 10.600-1.300A4.700 4.700 0 0 1 17 15zM12.500 16l-2 3h3l-2 3"/>',
  fog: '<path d="M4 9h16M4 13h16M6.500 17h11"/>',
  snow: '<path d="M12 3.500v17M4.6 7.7l14.8 8.6M4.6 16.3l14.8-8.6"/>',
  wind: '<path d="M3 9h10.500a2.500 2.500 0 1 0-2.500-2.500M3 13h15a2.500 2.500 0 1 1-2.500 2.500M3 17h7"/>',

  // ---- interface
  close: '<path d="M6.500 6.500l11 11M17.500 6.500l-11 11"/>',
  lock: '<rect class="d" x="5" y="10.500" width="14" height="10" rx="2"/><rect x="5" y="10.500" width="14" height="10" rx="2"/><path d="M8 10.500V8a4 4 0 0 1 8 0v2.500M12 14.500v2.500"/>',
  unlock: '<rect class="d" x="5" y="10.500" width="14" height="10" rx="2"/><rect x="5" y="10.500" width="14" height="10" rx="2"/><path d="M8 10.500V8a4 4 0 0 1 7.700-1.500M12 14.500v2.500"/>',
  sound: '<path class="d" d="M4 9.500h3.500L12 5.500v13l-4.500-4H4z"/><path d="M4 9.500h3.500L12 5.500v13l-4.500-4H4zM15.500 9a4.200 4.200 0 0 1 0 6M18 6.500a8 8 0 0 1 0 11"/>',
  mute: '<path class="d" d="M4 9.500h3.500L12 5.500v13l-4.500-4H4z"/><path d="M4 9.500h3.500L12 5.500v13l-4.500-4H4zM16 9.500l5 5M21 9.500l-5 5"/>',
  exit: '<path d="M13.500 4H6v16h7.500M10.500 12H21M17.500 8.500 21 12l-3.500 3.500"/>',
  right: '<path d="M9 5.500 15.500 12 9 18.500"/>',
  down: '<path d="M5.500 9 12 15.500 18.500 9"/>',
  up: '<path d="M5.500 15 12 8.500 18.500 15"/>',
  clock: '<circle cx="12" cy="12" r="8.600"/><path d="M12 7v5l3.300 2"/>',
  play: '<path class="f" d="M8 5.500v13l10-6.500z"/>',
  pause: '<path d="M7.500 5.500h3v13h-3zM13.500 5.500h3v13h-3z"/>',
  refresh: '<path d="M19.500 12a7.500 7.500 0 1 1-2.200-5.300M19.500 4v4h-4"/>',
  diamond: '<path class="f" d="M12 5.500 18.500 12 12 18.500 5.500 12z"/>',
  diamondo: '<path d="M12 5.500 18.500 12 12 18.500 5.500 12z"/>',
  trendup: '<path class="f" d="M12 7l5.500 9h-11z"/>',
  trenddown: '<path class="f" d="M12 17l5.500-9h-11z"/>',
  trendflat: '<path d="M6 12h12"/>',
  exclaim: '<path d="M12 4.500v9.500"/><circle class="f" cx="12" cy="18.500" r="1.300"/>',
  nosignal: '<path d="M4 20V17M9 20v-6M14 20v-9M19 20V8" opacity=".35"/><path d="M4.500 4.500l15 15"/>',
};

// Names the engine may send that are not literal glyph names.
const ALIAS = {
  // vitals
  health: "heart", energy: "bolt", stamina: "boot", fuel: "flame", focus: "eye", gold: "coin", mana: "drop",
  // log types
  steps: "boot", meal: "bowl", workout: "dumbbell", weigh: "scale", sleep: "moon", money: "coin", task: "check",
  travel: "plane", system: "chip", level: "levelup", quest: "quests", achievement: "crown", item: "box", note: "doc",
  contact: "party", place: "pin", attribute: "levelup", day: "chronicle", health: "pulse", checkin: "sparkle", mindful: "leaf", learn: "offhand", giving: "heart", device: "chip",
  // attributes
  strategy: "rook", body: "dumbbell", mind: "brain", things: "box", people: "party", joy: "sparkle", wealth: "treasury",
  connection: "link", growth: "sprout", impact: "target",
  // item categories
  clothes: "chest", clothing: "chest", shirt: "chest", top: "chest", pants: "legs", shorts: "legs", shoes: "feet", shoe: "feet",
  hat: "head", cap: "head", watch: "wrist", ring: "finger", jewellery: "neck", jewelry: "neck", bag: "back", backpack: "back",
  tech: "chip", electronics: "chip", computer: "laptop", audio: "headphones", eyewear: "glasses", sunglasses: "glasses",
  document: "doc", documents: "doc", tools: "tool", sport: "board", sports: "board", surf: "board", health_item: "heart",
  toiletries: "bottle", kitchen: "bowl", furniture: "home", misc: "box", other: "box", book: "offhand", books: "offhand",
  trinket1: "trinket", trinket2: "trinket", weapon: "laptop", torso: "chest", accessory: "wrist", car: "vehicle", scooter: "vehicle", fire: "flame", streak: "flame", water: "drop", rest: "moon", fed: "bowl",
  food: "bowl", gym: "dumbbell", debuff: "skull", buff: "star", time: "hourglass", alert: "warning", tv: "screen",
  // roster kinds
  companion: "sigil", guild: "banner", partner: "heart", friend: "person", team: "banner", host: "server",
  // places
  country: "flag",
};

export function iconName(name, fallback = "diamondo") {
  if (!name) return fallback;
  const k = String(name).toLowerCase();
  if (P[k]) return k;
  if (ALIAS[k] && P[ALIAS[k]]) return ALIAS[k];
  return fallback;
}

export function iconHTML(name, fallback) {
  return `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${P[iconName(name, fallback)]}</svg>`;
}

export function icon(name, cls, fallback) {
  const t = document.createElement("template");
  t.innerHTML = iconHTML(name, fallback);
  const el = t.content.firstChild;
  if (cls) el.classList.add(...cls.split(" "));
  return el;
}

// WMO weather interpretation codes (open-meteo) to a glyph.
export function weatherIcon(code, phase) {
  if (code == null) return "nosignal";
  if (code === 0 || code === 1) return phase === "night" ? "moon" : "sun";
  if (code === 2) return "partly";
  if (code === 3) return "cloud";
  if (code === 45 || code === 48) return "fog";
  if (code >= 95) return "storm";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 51) return "rain";
  return "cloud";
}

export const ICON_NAMES = Object.keys(P);

// The gold globe: favicon, app icon, loading sigil and the mark above the title. Three meridians
// sweep across it (CSS, .globe__m) so it reads as turning.
export function globeSVG() {
  return `<svg class="globe" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="gg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbefc8"/><stop offset=".5" stop-color="#d4b06a"/><stop offset="1" stop-color="#8a6c36"/></linearGradient></defs>
  <g fill="none" stroke="url(#gg)" stroke-width="1.5" stroke-linecap="round"><circle cx="32" cy="32" r="26"/><path d="M6 32h52M10.300 18.500h43.400M10.300 45.500h43.400"/>
  <ellipse class="globe__m globe__m--a" cx="32" cy="32" rx="26" ry="26"/><ellipse class="globe__m globe__m--b" cx="32" cy="32" rx="26" ry="26"/><ellipse class="globe__m globe__m--c" cx="32" cy="32" rx="26" ry="26"/></g></svg>`;
}
