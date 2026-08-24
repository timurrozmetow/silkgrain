import { ProductForm } from '../components/ProductForm';

/** Create mode: the form with no product behind it. */
function NewProduct() {
  return <ProductForm productId={null} />;
}

export default NewProduct;
