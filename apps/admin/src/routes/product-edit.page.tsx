import { getRouteApi } from '@tanstack/react-router';

import { ProductForm } from '../components/ProductForm';

/** Edit mode: the form seeded from an existing product. `PathId` has already coerced the id. */
const route = getRouteApi('/products/$id/edit');

function EditProduct() {
  const { id } = route.useParams();
  return <ProductForm productId={id} />;
}

export default EditProduct;
