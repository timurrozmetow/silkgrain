import type { RecipeCard as ApiRecipeCard, RecipeListResponse } from '@silkgrain/contracts';
import { EmptyState, Eyebrow, Icon, Skeleton } from '@silkgrain/ui';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '../lib/api';
import { Seo } from '../lib/seo';

/**
 * The recipes index.
 *
 * A centred intro, one large featured panel, then a three-up grid - the mockup's layout. The
 * featured recipe is whatever was published most recently, chosen by the server: a `featured`
 * column would be a second thing for an editor to keep in step with publishing.
 *
 * There is no detail page yet. The design never drew one (Q-25), and `/api/recipes/:slug`
 * returns everything it would need the day somebody does.
 */

const DIFFICULTY: Record<string, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Involved',
};

function Recipes() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['recipes'],
    queryFn: ({ signal }) => apiGet<RecipeListResponse>('/recipes', signal),
  });

  return (
    <div className="mx-auto max-w-container px-gutter py-14 tablet:px-gutter-tablet mobile:px-gutter-mobile mobile:py-8">
      <Seo
        title="Recipes — SilkGrain"
        description="The dishes these ingredients were grown for: plov, lagman, mosh-kichiri and more, written the way they are actually cooked."
        canonicalPath="/recipes"
      />
      <div className="mx-auto max-w-[60ch] text-center">
        <Eyebrow>From our kitchen</Eyebrow>
        <h1 className="mt-3 font-serif text-[42px] leading-tight text-ink mobile:text-[30px]">
          Recipes worth the good rice
        </h1>
        <p className="mt-4 text-body text-body-muted">
          The dishes these ingredients were grown for, written the way they are actually cooked —
          long simmers, whole spices, and no substitutions we would not make ourselves.
        </p>
      </div>

      {isPending ? (
        <div className="mt-12 space-y-8">
          <Skeleton className="h-[380px] w-full" />
          <div className="grid grid-cols-3 gap-6 tablet:grid-cols-2 mobile:grid-cols-1">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-64 w-full" />
            ))}
          </div>
        </div>
      ) : isError ? (
        <div className="mt-12">
          <EmptyState
            icon="warning-circle"
            title="The recipes could not be loaded"
            description="That is on us. Refreshing usually sorts it out."
          />
        </div>
      ) : data.featured === null ? (
        <div className="mt-12">
          <EmptyState
            icon="cooking-pot"
            tone="green"
            title="Nothing published yet"
            description="The first ones are being written and tested."
          />
        </div>
      ) : (
        <>
          <FeaturedPanel recipe={data.featured} />
          {data.items.length > 0 && (
            <div className="mt-10 grid grid-cols-3 gap-6 tablet:grid-cols-2 tablet:gap-5 mobile:grid-cols-1">
              {data.items.map((recipe) => (
                <RecipeTile key={recipe.slug} recipe={recipe} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Meta({ recipe, onDark = false }: { recipe: ApiRecipeCard; onDark?: boolean }) {
  const tone = onDark ? 'text-ondeep-muted' : 'text-muted';
  const accent = onDark ? 'text-gold' : 'text-green';
  return (
    <ul className={`flex flex-wrap items-center gap-5 font-mono text-[12px] ${tone}`}>
      <li className="flex items-center gap-1.5">
        <Icon name="clock" size={14} className={accent} />
        {recipe.totalMinutes} min
      </li>
      <li className="flex items-center gap-1.5">
        <Icon name="fire" size={14} className={accent} />
        {DIFFICULTY[recipe.difficulty] ?? recipe.difficulty}
      </li>
      <li className="flex items-center gap-1.5">
        <Icon name="users" size={14} className={accent} />
        Serves {recipe.servings}
      </li>
    </ul>
  );
}

function FeaturedPanel({ recipe }: { recipe: ApiRecipeCard }) {
  return (
    <article className="mt-12 grid min-h-[380px] grid-cols-2 overflow-hidden bg-green-deep tablet:grid-cols-1 mobile:mt-8">
      {/*
        The ratio is only needed once the panel stacks. Side by side, the text column sets the row
        height and the image fills it; at 1024 and below the image is on its own row with nothing
        reserving it, so everything under it jumps down when the photograph arrives. Measured at
        CLS 0.264 on mobile against 0.017-0.022 everywhere else, which is 13.5 points of the score
        - the same defect, and the same fix, as the /help skeleton that reserved 368px for a 744px
        list. `RecipeTile` below has carried `aspect-[4/3]` from the start; this panel never did.
      */}
      <div className="flex items-center justify-center bg-gradient-to-br from-gold-pale to-surface tablet:aspect-[16/10]">
        {recipe.image === null ? (
          <Icon name="cooking-pot" size={80} className="text-green/25" />
        ) : (
          <img
            src={recipe.image.url}
            alt={recipe.image.alt}
            className="h-full w-full object-cover"
          />
        )}
      </div>
      <div className="flex flex-col justify-center p-12 tablet:p-8 mobile:p-6">
        <span className="w-fit bg-gold px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-green-deep">
          Featured
        </span>
        <h2 className="mt-5 font-display text-[38px] font-medium leading-tight text-ondeep mobile:text-[27px]">
          {recipe.title}
        </h2>
        <p className="mt-3 max-w-[46ch] text-bodySm text-ondeep-muted">{recipe.excerpt}</p>
        <div className="mt-6">
          <Meta recipe={recipe} onDark />
        </div>
      </div>
    </article>
  );
}

function RecipeTile({ recipe }: { recipe: ApiRecipeCard }) {
  return (
    <article className="flex flex-col border border-line bg-surface">
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-gradient-to-br from-gold-pale to-surface">
        {recipe.image === null ? (
          <Icon name="cooking-pot" size={44} className="text-green/25" />
        ) : (
          <img
            src={recipe.image.url}
            alt={recipe.image.alt}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        )}
      </div>
      <div className="flex flex-1 flex-col p-6 mobile:p-5">
        <h3 className="font-serif text-[22px] leading-snug text-ink">{recipe.title}</h3>
        <p className="mt-2 flex-1 text-bodySm text-body-muted">{recipe.excerpt}</p>
        <div className="mt-5 border-t border-line-soft pt-4">
          <Meta recipe={recipe} />
        </div>
      </div>
    </article>
  );
}

export default Recipes;
