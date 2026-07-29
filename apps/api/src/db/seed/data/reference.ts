/**
 * Reference content the mockup does not contain: nutrition panels, review copy and recipe
 * bodies.
 *
 * **The nutrition figures are category reference values, not label data.** They are typical
 * published values for the food class, close enough that the FDA panel renders and sorts
 * sensibly, and they must be replaced per product with the supplier's certificate of analysis
 * before the store takes a real order. Tracked as Q-43 in QUESTIONS.md.
 *
 * Every quantity is an integer in milligrams, matching `product_nutrition`. No floats reach
 * the database, so a panel showing "1.5 g" is 1500 here and renders by division.
 */

export interface NutritionProfile {
  servingSize: string;
  servingsPerContainer: number | null;
  calories: number;
  fatMg: number;
  satFatMg: number;
  carbsMg: number;
  sugarsMg: number;
  fiberMg: number;
  proteinMg: number;
  sodiumMg: number;
  ingredientsText: string;
  allergensText: string | null;
}

const G = 1000;

export const NUTRITION_BY_CATEGORY: Record<string, NutritionProfile> = {
  rice: {
    servingSize: '1/4 cup dry (45 g)',
    servingsPerContainer: null,
    calories: 160,
    fatMg: 500,
    satFatMg: 100,
    carbsMg: 35 * G,
    sugarsMg: 0,
    fiberMg: 1 * G,
    proteinMg: 3 * G,
    sodiumMg: 0,
    ingredientsText: 'Whole grain.',
    allergensText: 'Packed in a facility that also handles wheat and sesame.',
  },
  lentils: {
    servingSize: '1/4 cup dry (45 g)',
    servingsPerContainer: null,
    calories: 160,
    fatMg: 500,
    satFatMg: 100,
    carbsMg: 27 * G,
    sugarsMg: 1 * G,
    fiberMg: 11 * G,
    proteinMg: 12 * G,
    sodiumMg: 5,
    ingredientsText: 'Whole pulses.',
    allergensText: 'Packed in a facility that also handles wheat and sesame.',
  },
  fruits: {
    servingSize: '1/4 cup (40 g)',
    servingsPerContainer: null,
    calories: 120,
    fatMg: 300,
    satFatMg: 0,
    carbsMg: 31 * G,
    sugarsMg: 25 * G,
    fiberMg: 4 * G,
    proteinMg: 1 * G,
    sodiumMg: 5,
    ingredientsText: 'Dried fruit. No added sugar, no sulphites.',
    allergensText: 'Packed in a facility that also handles tree nuts.',
  },
  spices: {
    servingSize: '1 tsp (2 g)',
    servingsPerContainer: null,
    calories: 7,
    fatMg: 400,
    satFatMg: 0,
    carbsMg: 1 * G,
    sugarsMg: 0,
    fiberMg: 500,
    proteinMg: 300,
    sodiumMg: 2,
    ingredientsText: 'Whole or ground spice, nothing added.',
    allergensText: null,
  },
  flour: {
    servingSize: '1/4 cup (30 g)',
    servingsPerContainer: null,
    calories: 110,
    fatMg: 1 * G,
    satFatMg: 100,
    carbsMg: 22 * G,
    sugarsMg: 0,
    fiberMg: 2 * G,
    proteinMg: 4 * G,
    sodiumMg: 1,
    ingredientsText: 'Milled grain or seed.',
    allergensText: 'Contains wheat where the product name says so. Also handles sesame.',
  },
  mixes: {
    servingSize: '1 tbsp (7 g)',
    servingsPerContainer: null,
    calories: 25,
    fatMg: 1 * G,
    satFatMg: 200,
    carbsMg: 4 * G,
    sugarsMg: 0,
    fiberMg: 1 * G,
    proteinMg: 1 * G,
    sodiumMg: 15,
    ingredientsText: 'Blended spices and grains. See the product description for the full list.',
    allergensText: 'Contains wheat in kits. Packed alongside sesame.',
  },
};

// --------------------------------------------------------------------------------------
// Reviews
// --------------------------------------------------------------------------------------

export interface SeedReview {
  authorName: string;
  rating: number;
  title: string;
  body: string;
}

/**
 * A pool the seed draws from deterministically, so two runs produce the same catalogue and a
 * diff of the database means something. Ratings skew high because the products are all
 * bestsellers in the mockup, but the pool contains genuine three- and four-star copy too -
 * a catalogue where every review is five stars reads as fake and gives the histogram on the
 * product page nothing to draw.
 */
export const REVIEW_POOL: SeedReview[] = [
  {
    authorName: 'Dilshod R.',
    rating: 5,
    title: 'Exactly what I grew up with',
    body: 'I have been buying rice from three different importers and this is the first that smells right when it cooks. The grain stays separate and takes the broth the way it should.',
  },
  {
    authorName: 'Maria H.',
    rating: 5,
    title: 'Worth the price',
    body: 'More expensive than the supermarket, and it is not close in quality. Arrived quickly and the packaging was properly sealed.',
  },
  {
    authorName: 'Tom W.',
    rating: 4,
    title: 'Very good, bag could be better',
    body: 'No complaints about the product at all. The resealable strip on the bag gave up after a couple of weeks, so I decant it now.',
  },
  {
    authorName: 'Nargiza S.',
    rating: 5,
    title: 'Tastes like home',
    body: 'Hard to find this properly in Texas. I ordered the large size and I will be ordering again before it runs out.',
  },
  {
    authorName: 'David B.',
    rating: 4,
    title: 'Good quality, slow delivery',
    body: 'The product is excellent. Shipping took a day longer than the estimate, which is the only reason this is not five stars.',
  },
  {
    authorName: 'Laila Y.',
    rating: 5,
    title: 'Consistent every time',
    body: 'Third order. Same quality each time, which matters more to me than anything else when I am cooking for a crowd.',
  },
  {
    authorName: 'Aziz K.',
    rating: 3,
    title: 'Fine, but I expected more',
    body: 'Perfectly decent and clean, no stones or chaff. I had read the description and expected something more distinctive for the money.',
  },
  {
    authorName: 'Rebecca L.',
    rating: 5,
    title: 'Made the best plov of my life',
    body: 'Followed the recipe on the site and it worked. I have cooked this dish for years with ordinary long-grain rice and had no idea what I was missing.',
  },
  {
    authorName: 'Umid T.',
    rating: 4,
    title: 'Good, would like a bigger size',
    body: 'Quality is there. I go through this quickly and would happily buy a 25 lb bag if it is ever offered.',
  },
  {
    authorName: 'Sarah K.',
    rating: 5,
    title: 'Beautifully fresh',
    body: 'You can tell within a second of opening the bag. Whatever they are doing about turnover, it is working.',
  },
  {
    authorName: 'Jonathan P.',
    rating: 4,
    title: 'Solid staple',
    body: 'Nothing dramatic to say — it is clean, it cooks evenly, and it is now the one I keep in the pantry.',
  },
  {
    authorName: 'Gulnora A.',
    rating: 5,
    title: 'My mother approved',
    body: 'That is the highest bar in this house and it cleared it. Ordering the family size next time.',
  },
];

// --------------------------------------------------------------------------------------
// Recipes
// --------------------------------------------------------------------------------------

/**
 * The mockup gives each recipe a title, a time, a level and one line of copy; there is no
 * detail page design and no body text anywhere in the bundle. These bodies are written for
 * the seed so `/recipes/:slug` has something real to render.
 */
export interface RecipeBody {
  /** Split of the mockup's single "time" figure; the two always add up to it. */
  prepMinutes: number;
  cookMinutes: number;
  servings: number;
  /** Product slugs for the "Shop the ingredients" strip. */
  products: string[];
  body: string;
}

export const RECIPE_BODIES: Record<string, RecipeBody> = {
  'uzbek-lamb-plov': {
    prepMinutes: 30,
    cookMinutes: 60,
    servings: 6,
    products: [
      'uzbek-devzira-rice',
      'zira-cumin-seeds',
      'yellow-chickpeas-nohat',
      'dried-barberries-zirk',
    ],
    body: `## Ingredients

- 2 lb Uzbek Devzira rice, rinsed until the water runs clear
- 2 lb lamb shoulder, cut into large cubes
- 1 lb yellow carrots, cut into batons the thickness of a finger
- 2 large onions, sliced thin
- 1 whole head of garlic, unpeeled
- 2 tbsp zira (cumin seed), lightly crushed
- 1 tbsp dried barberries
- 1/2 cup cooked chickpeas
- 3/4 cup neutral oil or rendered tail fat
- Salt

## Method

1. Soak the rinsed rice in warm salted water for 40 minutes while you build the base.
2. Heat the oil in a kazan or a heavy casserole until it shimmers. Brown the lamb hard, in batches — crowding it steams the meat and you lose the crust the whole dish is built on.
3. Add the onions and cook until deep gold. Add the carrots and cook without stirring for five minutes, then fold gently. The carrots should soften but keep their shape.
4. Add the zira, chickpeas, barberries and enough water to just cover. Bury the whole garlic head in the middle. Simmer, uncovered, for 45 minutes. This is the zirvak, and it is where the flavour is decided.
5. Drain the rice and spread it over the zirvak without stirring. Add boiling water to sit one finger-width above the rice. Boil hard until the water is at the level of the rice.
6. Gather the rice into a mound, poke a few holes down to the base with the handle of a spoon, cover tightly and cook on the lowest heat for 25 minutes.
7. Rest off the heat for ten minutes, then turn out onto a platter, meat on top, garlic in the centre.

The garlic is served whole and squeezed over the plate at the table.`,
  },
  'mosh-kichiri': {
    prepMinutes: 15,
    cookMinutes: 40,
    servings: 4,
    products: ['green-mung-beans', 'lazer-white-rice', 'zira-cumin-seeds'],
    body: `## Ingredients

- 1 cup whole green mung beans
- 1 cup medium-grain rice
- 1 onion, diced
- 1 carrot, diced small
- 2 tsp zira (cumin seed)
- 1/4 cup oil
- Salt, black pepper
- Yoghurt and dill, to serve

## Method

1. Rinse the mung beans and simmer in 4 cups of water for 25 minutes, until the skins begin to split.
2. Meanwhile, fry the onion in the oil until golden, add the carrot and the zira, and cook for another five minutes.
3. Tip the fried vegetables into the beans along with the rinsed rice. Add water to sit two fingers above the surface.
4. Simmer uncovered, stirring now and then, for 25–30 minutes, until it is thick enough that a spoon stands up in it for a moment.
5. Season, cover, and rest off the heat for ten minutes.

Serve hot with a spoon of cold yoghurt and a lot of dill. It thickens further overnight and is arguably better the next day.`,
  },
  'samarkand-non': {
    prepMinutes: 150,
    cookMinutes: 30,
    servings: 2,
    products: ['wheat-flour-oliy', 'sesame-seeds'],
    body: `## Ingredients

- 500 g high-grade wheat flour
- 300 ml warm water
- 7 g instant yeast
- 10 g salt
- 1 tbsp sesame seeds
- 1 tsp nigella seeds
- 1 egg yolk, for glazing

## Method

1. Mix the flour, yeast and salt. Add the water and bring together into a stiff dough — stiffer than a bread dough you may be used to. Knead for ten minutes.
2. Prove, covered, for 90 minutes, until doubled.
3. Knock back, divide into two, and shape each into a tight ball. Rest for 20 minutes.
4. Flatten each ball into a disc, leaving a raised rim two fingers wide. Press the centre flat and dimple it thoroughly — a chekich stamp if you have one, a fork if you do not. The centre must not rise.
5. Glaze the rim with egg yolk and scatter sesame and nigella over the middle.
6. Bake on a preheated stone at the highest temperature your oven reaches, 230–250 °C, for 15–18 minutes.

A home oven will not give you a tandoor crust. Preheating a stone for a full 45 minutes gets you closer than anything else.`,
  },
  'dried-fruit-compote': {
    prepMinutes: 10,
    cookMinutes: 20,
    servings: 6,
    products: ['dried-apricots-kuraga', 'golden-raisins-kishmish', 'dried-black-plums'],
    body: `## Ingredients

- 1 cup dried apricots
- 1/2 cup golden raisins
- 1/2 cup dried plums
- 2 litres water
- 3 tbsp sugar, or to taste
- 1 cinnamon stick
- 2 strips of lemon peel

## Method

1. Rinse the fruit in warm water. Do not soak it — the flavour you want ends up in the soaking water.
2. Bring the water to a boil with the sugar, cinnamon and lemon peel.
3. Add the plums first and simmer for ten minutes, then the apricots for another ten, then the raisins for the last five. They soften at different rates and adding them together turns the raisins to pulp.
4. Take off the heat, cover, and leave for at least two hours. Overnight is better.

Serve cold in summer and warm in winter. The fruit is eaten afterwards with a spoon.`,
  },
  'lagman-hand-pulled-noodles': {
    prepMinutes: 90,
    cookMinutes: 30,
    servings: 4,
    products: ['lagman-noodle-kit', 'zira-cumin-seeds', 'sumac-ground'],
    body: `## Ingredients

**Noodles**

- 500 g high-protein flour
- 250 ml water
- 8 g salt
- Oil, for coating

**Sauce**

- 500 g beef, cut into strips
- 2 bell peppers, 2 tomatoes, 1 onion, all sliced
- 3 cloves garlic
- 2 tsp zira, 1 tsp sumac
- Soy sauce, vinegar, salt

## Method

1. Make the dough: mix flour, salt and water, knead until smooth, then rest for 30 minutes. Knead again for five minutes and rest for another hour. The second rest is what makes it stretch.
2. Roll the dough into a thick rope, coil it in an oiled dish, coat every surface with oil and rest for a final hour under cling film.
3. Sear the beef hard. Add the onion, then the peppers, then the tomatoes, then the spices. Add a cup of water and simmer for 20 minutes.
4. Pull the noodles: take a length of rope, stretch it between your hands, slap it against the counter, fold, repeat. Work it down to the thickness of a pencil lead. Drop straight into boiling water for two minutes.
5. Drain, bowl, sauce on top, sumac over.

If the dough tears, it has not rested long enough. Put it back and wait.`,
  },
  'saffron-rice-pilaf': {
    prepMinutes: 15,
    cookMinutes: 25,
    servings: 4,
    products: ['saffron-threads', 'lazer-white-rice', 'golden-raisins-kishmish'],
    body: `## Ingredients

- 2 cups medium-grain rice
- A generous pinch of saffron threads
- 3 tbsp butter
- 1 small onion, sliced fine
- 1/4 cup golden raisins
- 3 cups hot stock or water
- Salt

## Method

1. Crush the saffron between your fingers into a small cup and pour over three tablespoons of hot — not boiling — water. Leave for 20 minutes. It should turn deep orange.
2. Rinse the rice until the water runs clear.
3. Melt the butter and soften the onion without colouring it. Add the rice and stir for two minutes until every grain is coated.
4. Add the stock, the raisins, the saffron with its liquid, and salt. Bring to a boil, then cover and drop to the lowest heat for 15 minutes.
5. Rest, covered and off the heat, for ten minutes. Fork through before serving.

Boiling water kills saffron's aroma. If the infusion smells of nothing, the water was too hot.`,
  },
};
