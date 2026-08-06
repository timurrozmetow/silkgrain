import type { NutritionFacts } from '@silkgrain/contracts';

/**
 * The FDA Nutrition Facts panel.
 *
 * Its typography is regulated, not designed: the heavy rules, the bold Calories line and the
 * indented sub-nutrients are what 21 CFR 101.9 requires, which is why this component looks
 * nothing like the rest of the storefront and must not be tidied up to match it.
 *
 * Every quantity is stored in milligrams (decision D-14) and divided here. The values the seed
 * carries are category-level reference figures; the real ones come from the supplier's
 * certificate of analysis and are entered in the admin panel (decision D-20).
 */
export function NutritionPanel({ facts }: { facts: NutritionFacts }) {
  const grams = (milligrams: number) => `${String(round(milligrams / 1000, 1))}g`;

  return (
    <table className="w-[300px] max-w-full border-2 border-ink bg-white font-sans text-ink mobile:w-full">
      <caption className="border-b-[8px] border-ink px-3 pb-1 pt-2 text-left">
        <span className="block text-[26px] font-extrabold leading-none tracking-tight">
          Nutrition Facts
        </span>
        <span className="mt-1 block text-[12px]">
          Serving size <strong className="font-bold">{facts.servingSize}</strong>
        </span>
        {facts.servingsPerContainer !== null && (
          <span className="block text-[12px]">
            About {facts.servingsPerContainer} servings per container
          </span>
        )}
      </caption>

      <tbody>
        <tr className="border-b-[4px] border-ink">
          <th scope="row" className="px-3 py-1 text-left text-[15px] font-extrabold">
            Calories
          </th>
          <td className="px-3 py-1 text-right text-[24px] font-extrabold leading-none">
            {facts.calories}
          </td>
        </tr>

        <Line label="Total Fat" value={grams(facts.fatMg)} bold />
        <Line label="Saturated Fat" value={grams(facts.satFatMg)} indent />
        <Line label="Sodium" value={`${String(facts.sodiumMg)}mg`} bold />
        <Line label="Total Carbohydrate" value={grams(facts.carbsMg)} bold />
        <Line label="Dietary Fiber" value={grams(facts.fiberMg)} indent />
        <Line label="Total Sugars" value={grams(facts.sugarsMg)} indent />
        <Line label="Protein" value={grams(facts.proteinMg)} bold last />
      </tbody>
    </table>
  );
}

function Line({
  label,
  value,
  bold = false,
  indent = false,
  last = false,
}: {
  label: string;
  value: string;
  bold?: boolean;
  indent?: boolean;
  last?: boolean;
}) {
  return (
    <tr className={last ? 'border-t-[4px] border-ink' : 'border-b border-ink/25'}>
      <th
        scope="row"
        className={`py-1 text-left text-[13px] ${bold ? 'font-bold' : ''} ${
          indent ? 'pl-7 pr-3' : 'px-3'
        }`}
      >
        {label}
      </th>
      <td className="px-3 py-1 text-right text-[13px]">{value}</td>
    </tr>
  );
}

/** One decimal, without dragging a formatting library in for four call sites. */
function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
