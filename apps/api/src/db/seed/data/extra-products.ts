/**
 * Sixteen products beyond the mockup's sixteen, taking the catalogue to thirty-two.
 *
 * Written in the same shape the extractor produces, so the seed treats both sources
 * identically. Everything here is a real Central Asian pantry item with a real growing
 * region; prices sit in the same band as the designer's so the shop's price filter has a
 * sensible distribution to work against.
 */

export interface SeedProduct {
  slug: string;
  name: string;
  catKey: string;
  origin: string;
  region: string;
  badges: string[];
  stock: 'in' | 'low' | 'out';
  defWeight: string;
  tone: string;
  icon: string;
  blurb: string;
  desc: string;
  weights: { label: string; price: number }[];
  imageUrl: string | null;
}

const MEALDB = 'https://www.themealdb.com/images/ingredients/';
const WIKIMEDIA = (name: string): string =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${name}?width=600`;

export const EXTRA_PRODUCTS: SeedProduct[] = [
  // ---------------------------------------------------------------------------- rice
  {
    slug: 'samarkand-bulgur',
    name: 'Samarkand Bulgur Wheat',
    catKey: 'rice',
    origin: 'Uzbekistan',
    region: 'Samarkand, Uzbekistan',
    badges: [],
    stock: 'in',
    defWeight: '2 lb',
    tone: 'linear-gradient(135deg,#F0E6CE,#D8C39A)',
    icon: 'ph-bowl-food',
    blurb: 'Parboiled cracked wheat that cooks in twelve minutes.',
    desc: 'Durum wheat, steamed, dried and cracked the way it has been done around Samarkand for centuries. Medium grind: coarse enough to stay separate in a pilaf, fine enough for a fast weeknight side.',
    weights: [
      { label: '1 lb', price: 6.5 },
      { label: '2 lb', price: 11.99 },
      { label: '5 lb', price: 27 },
    ],
    imageUrl: WIKIMEDIA('Bulgur.jpg'),
  },
  {
    slug: 'pearl-barley',
    name: 'Pearl Barley (Perlovka)',
    catKey: 'rice',
    origin: 'Kazakhstan',
    region: 'Akmola, Kazakhstan',
    badges: [],
    stock: 'in',
    defWeight: '2 lb',
    tone: 'linear-gradient(135deg,#F2EEE0,#DED5BC)',
    icon: 'ph-bowl-food',
    blurb: 'Polished barley for shurpa and slow soups.',
    desc: 'Hulled and polished barley with the bran gently removed. It thickens a broth as it cooks and keeps a satisfying chew, which is why every Central Asian soup pot has a bag of it nearby.',
    weights: [
      { label: '2 lb', price: 7.99 },
      { label: '5 lb', price: 17.5 },
    ],
    imageUrl: WIKIMEDIA('Barley%20grains.jpg'),
  },
  {
    slug: 'buckwheat-groats',
    name: 'Roasted Buckwheat Groats (Grechka)',
    catKey: 'rice',
    origin: 'Kazakhstan',
    region: 'North Kazakhstan',
    badges: ['New'],
    stock: 'in',
    defWeight: '2 lb',
    tone: 'linear-gradient(135deg,#E9DECB,#BFA684)',
    icon: 'ph-bowl-food',
    blurb: 'Toasted groats with a deep, nutty aroma.',
    desc: 'Whole buckwheat kernels roasted before packing, which is what gives grechka its brown colour and its unmistakable smell. Naturally gluten free and ready in fifteen minutes.',
    weights: [
      { label: '1 lb', price: 6.25 },
      { label: '2 lb', price: 11.5 },
      { label: '5 lb', price: 26 },
    ],
    imageUrl: WIKIMEDIA('Buckwheat%20groats.jpg'),
  },
  // ------------------------------------------------------------------------- lentils
  {
    slug: 'green-lentils',
    name: 'Green Lentils',
    catKey: 'lentils',
    origin: 'Kazakhstan',
    region: 'Kostanay, Kazakhstan',
    badges: [],
    stock: 'in',
    defWeight: '2 lb',
    tone: 'linear-gradient(135deg,#DFE5CD,#A8B888)',
    icon: 'ph-circles-three',
    blurb: 'Firm green lentils that hold their shape.',
    desc: 'Whole green lentils that stay intact through a long simmer, unlike their red cousins. The default choice for a lentil salad or anything that needs texture at the end of cooking.',
    weights: [
      { label: '1 lb', price: 6.99 },
      { label: '2 lb', price: 12.75 },
      { label: '5 lb', price: 29 },
    ],
    imageUrl: WIKIMEDIA('Lentils.jpg'),
  },
  {
    slug: 'white-kidney-beans',
    name: 'White Kidney Beans (Lobiya)',
    catKey: 'lentils',
    origin: 'Uzbekistan',
    region: 'Andijan, Uzbekistan',
    badges: [],
    stock: 'in',
    defWeight: '2 lb',
    tone: 'linear-gradient(135deg,#F4F0E4,#DCD3BE)',
    icon: 'ph-circles-three',
    blurb: 'Creamy large white beans for lobiyo and stews.',
    desc: 'Large, thin-skinned white beans that cook to a creamy interior without falling apart. Soak overnight and they carry a garlic-and-walnut dressing better than any other bean.',
    weights: [
      { label: '1 lb', price: 7.25 },
      { label: '2 lb', price: 13.25 },
    ],
    imageUrl: WIKIMEDIA('White%20beans.jpg'),
  },
  {
    slug: 'yellow-split-peas',
    name: 'Yellow Split Peas',
    catKey: 'lentils',
    origin: 'Kyrgyzstan',
    region: 'Chuy Valley, Kyrgyzstan',
    badges: [],
    stock: 'low',
    defWeight: '2 lb',
    tone: 'linear-gradient(135deg,#F2E9C6,#D6BE73)',
    icon: 'ph-circles-three',
    blurb: 'Sweet split peas that melt into a thick soup.',
    desc: 'Split and hulled yellow peas from the Chuy Valley. No soaking needed; forty minutes and they collapse into the silky base a proper pea soup is built on.',
    weights: [
      { label: '1 lb', price: 5.5 },
      { label: '2 lb', price: 9.99 },
      { label: '5 lb', price: 22.5 },
    ],
    imageUrl: WIKIMEDIA('Yellow%20split%20peas.jpg'),
  },
  // -------------------------------------------------------------------------- fruits
  {
    slug: 'dried-figs-anjir',
    name: 'Dried Figs (Anjir)',
    catKey: 'fruits',
    origin: 'Uzbekistan',
    region: 'Surkhandarya, Uzbekistan',
    badges: ['Bestseller'],
    stock: 'in',
    defWeight: '1 lb',
    tone: 'linear-gradient(135deg,#EFE2C4,#C9AE7E)',
    icon: 'ph-cherries',
    blurb: 'Whole sun-dried figs, jammy and seed-crunchy.',
    desc: 'Figs left on the tree until they are almost candied, then dried whole in the southern Uzbek sun. Soft enough to tear by hand, sweet enough that nothing is added.',
    weights: [
      { label: '8 oz', price: 9.5 },
      { label: '1 lb', price: 17.5 },
      { label: '2 lb', price: 32 },
    ],
    imageUrl: `${MEALDB}Figs.png`,
  },
  {
    slug: 'dried-melon-strips',
    name: 'Dried Melon Strips',
    catKey: 'fruits',
    origin: 'Turkmenistan',
    region: 'Mary, Turkmenistan',
    badges: ['New'],
    stock: 'in',
    defWeight: '8 oz',
    tone: 'linear-gradient(135deg,#F6EDD2,#E4C88A)',
    icon: 'ph-cherries',
    blurb: 'Braided melon ribbons, honey-sweet and chewy.',
    desc: 'Gulabi melon cut into ribbons, air-dried and traditionally braided. Turkmen melons are famous across the region for their perfume, and drying concentrates all of it.',
    weights: [
      { label: '8 oz', price: 11.99 },
      { label: '1 lb', price: 22 },
    ],
    imageUrl: WIKIMEDIA('Dried%20melon.jpg'),
  },
  {
    slug: 'dried-sour-cherries',
    name: 'Dried Sour Cherries',
    catKey: 'fruits',
    origin: 'Tajikistan',
    region: 'Sughd, Tajikistan',
    badges: [],
    stock: 'in',
    defWeight: '8 oz',
    tone: 'linear-gradient(135deg,#E8CFC6,#B47264)',
    icon: 'ph-cherries',
    blurb: 'Tart cherries with no added sugar.',
    desc: 'Pitted sour cherries dried until they are dense and sharply tart. They cut through a rich plov, and they are the reason a Tajik compote tastes like nothing else.',
    weights: [
      { label: '8 oz', price: 13.25 },
      { label: '1 lb', price: 24.5 },
    ],
    imageUrl: `${MEALDB}Cherries.png`,
  },
  // -------------------------------------------------------------------------- spices
  {
    slug: 'dried-barberries-zirk',
    name: 'Dried Barberries (Zirk)',
    catKey: 'spices',
    origin: 'Uzbekistan',
    region: 'Namangan, Uzbekistan',
    badges: ['Bestseller'],
    stock: 'in',
    defWeight: '4 oz',
    tone: 'linear-gradient(135deg,#EACFC4,#B4614B)',
    icon: 'ph-leaf',
    blurb: 'Tiny crimson berries, sharp and bright.',
    desc: 'The scarlet flecks in a good plov. Barberries are picked late, dried whole and scattered over rice at the end of cooking, where their sourness lifts the fat.',
    weights: [
      { label: '4 oz', price: 8.99 },
      { label: '8 oz', price: 16.5 },
    ],
    imageUrl: WIKIMEDIA('Berberis%20vulgaris%20dried%20fruits.jpg'),
  },
  {
    slug: 'coriander-seeds',
    name: 'Coriander Seeds',
    catKey: 'spices',
    origin: 'Uzbekistan',
    region: 'Kashkadarya, Uzbekistan',
    badges: [],
    stock: 'in',
    defWeight: '8 oz',
    tone: 'linear-gradient(135deg,#EFE7D2,#C9B889)',
    icon: 'ph-leaf',
    blurb: 'Whole seeds with a citrus-warm aroma.',
    desc: 'Round, pale coriander seed harvested at full ripeness. Crush it just before use — ground coriander loses its lemon note within weeks, and this is what you are paying for.',
    weights: [
      { label: '4 oz', price: 5.5 },
      { label: '8 oz', price: 9.99 },
      { label: '1 lb', price: 17.5 },
    ],
    imageUrl: `${MEALDB}Coriander.png`,
  },
  {
    slug: 'ground-turmeric',
    name: 'Ground Turmeric',
    catKey: 'spices',
    origin: 'Mixed Origin',
    region: 'Central Asia',
    badges: [],
    stock: 'in',
    defWeight: '4 oz',
    tone: 'linear-gradient(135deg,#F3E2B4,#D9A62E)',
    icon: 'ph-leaf',
    blurb: 'Deep-gold turmeric, milled fine.',
    desc: 'Rhizomes dried and stone-milled to a fine, intensely coloured powder. A quarter teaspoon turns a pot of rice the colour a plov is supposed to be.',
    weights: [
      { label: '4 oz', price: 6.75 },
      { label: '8 oz', price: 12 },
    ],
    imageUrl: `${MEALDB}Turmeric.png`,
  },
  // --------------------------------------------------------------------------- flour
  {
    slug: 'chickpea-flour',
    name: 'Chickpea Flour (Nokhodi)',
    catKey: 'flour',
    origin: 'Uzbekistan',
    region: 'Bukhara, Uzbekistan',
    badges: ['Organic'],
    stock: 'in',
    defWeight: '2 lb',
    tone: 'linear-gradient(135deg,#F4EBD3,#DCC48D)',
    icon: 'ph-plant',
    blurb: 'Stone-milled chickpea flour, naturally gluten free.',
    desc: 'Organic Bukhara chickpeas milled to a fine flour. Thickens a stew without a roux, fries into a crisp batter, and binds a vegetarian kufta the way nothing else does.',
    weights: [
      { label: '1 lb', price: 7.5 },
      { label: '2 lb', price: 13.99 },
    ],
    imageUrl: WIKIMEDIA('Gram%20flour.jpg'),
  },
  {
    slug: 'golden-flax-seeds',
    name: 'Golden Flax Seeds',
    catKey: 'flour',
    origin: 'Kazakhstan',
    region: 'Kostanay, Kazakhstan',
    badges: ['Organic'],
    stock: 'in',
    defWeight: '1 lb',
    tone: 'linear-gradient(135deg,#F3EDD9,#D9C58F)',
    icon: 'ph-plant',
    blurb: 'Whole golden flax, cold-stored for freshness.',
    desc: 'Kazakhstan grows some of the best flax in the world and most of it leaves as oil. These are whole seeds, kept cold from field to bag so the oils in them have not turned.',
    weights: [
      { label: '1 lb', price: 8.25 },
      { label: '2 lb', price: 15 },
    ],
    imageUrl: WIKIMEDIA('Flax%20seeds.jpg'),
  },
  {
    slug: 'hulled-pumpkin-seeds',
    name: 'Hulled Pumpkin Seeds',
    catKey: 'flour',
    origin: 'Uzbekistan',
    region: 'Khorezm, Uzbekistan',
    badges: [],
    stock: 'low',
    defWeight: '1 lb',
    tone: 'linear-gradient(135deg,#E4EBD0,#A9BC85)',
    icon: 'ph-plant',
    blurb: 'Deep-green kernels, raw and unsalted.',
    desc: 'Naked-seed pumpkins grown for the kernel, so there is no husk to remove. Raw and unsalted: toast them yourself and they taste like something entirely different.',
    weights: [
      { label: '8 oz', price: 7.99 },
      { label: '1 lb', price: 14.5 },
    ],
    imageUrl: `${MEALDB}Pumpkin%20Seeds.png`,
  },
  // --------------------------------------------------------------------------- mixes
  {
    slug: 'shurpa-spice-mix',
    name: 'Shurpa Spice Blend',
    catKey: 'mixes',
    origin: 'Uzbekistan',
    region: 'Tashkent, Uzbekistan',
    badges: ['New'],
    stock: 'in',
    defWeight: '4 oz',
    tone: 'linear-gradient(135deg,#EFDFC0,#C8A263)',
    icon: 'ph-cooking-pot',
    blurb: 'For the long-simmered lamb and vegetable soup.',
    desc: 'Coriander, zira, black pepper, dried tomato and a little dried mint, ground coarse. Built for shurpa, where the spice has three hours to open up rather than three minutes.',
    weights: [
      { label: '4 oz', price: 8.99 },
      { label: '8 oz', price: 15.5 },
    ],
    imageUrl: `${MEALDB}Coriander.png`,
  },
];
