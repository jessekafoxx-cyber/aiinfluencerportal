import { getUncachableStripeClient } from './stripeClient';

async function createProducts() {
  try {
    const stripe = await getUncachableStripeClient();
    console.log('Creating funnel products in Stripe...');

    const products = [
      {
        name: 'Low-Ticket Acquisition and Operating System',
        description: 'Complete system + all bonuses — lifetime access',
        amount: 9700,
        metadata: { funnel_step: 'main', order: '1' },
      },
      {
        name: 'Done-For-You Templates Pack',
        description: 'Pre-built templates, swipe files, and automation scripts',
        amount: 19700,
        metadata: { funnel_step: 'upsell1', order: '2' },
      },
      {
        name: 'Templates Lite',
        description: 'Core templates and quick-start swipe files',
        amount: 4700,
        metadata: { funnel_step: 'downsell1', order: '3' },
      },
      {
        name: 'Private Mastermind Access',
        description: '90-day private mastermind group with weekly calls',
        amount: 29700,
        metadata: { funnel_step: 'upsell2', order: '4' },
      },
      {
        name: '1-on-1 Strategy Session',
        description: 'Personal 60-minute strategy call with Gregory',
        amount: 49700,
        metadata: { funnel_step: 'upsell3', order: '5' },
      },
    ];

    for (const p of products) {
      const existing = await stripe.products.search({
        query: `name:'${p.name}' AND active:'true'`
      });

      if (existing.data.length > 0) {
        console.log(`✓ "${p.name}" already exists (${existing.data[0].id})`);
        continue;
      }

      const product = await stripe.products.create({
        name: p.name,
        description: p.description,
        metadata: p.metadata,
      });

      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: p.amount,
        currency: 'usd',
      });

      console.log(`✓ Created "${p.name}" — $${(p.amount / 100).toFixed(2)} (${product.id} / ${price.id})`);
    }

    console.log('\n✓ All funnel products created successfully!');
  } catch (error: any) {
    console.error('Error creating products:', error.message);
    process.exit(1);
  }
}

createProducts();
