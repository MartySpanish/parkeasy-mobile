// stripeConfig.js - Stripe Integration Helper
// This file will help you integrate Stripe payments when you're ready

import { Alert, Linking } from 'react-native';

// ✅ STRIPE PAYMENT LINKS - CONFIGURED (February 2026)
const STRIPE_PAYMENT_LINKS = {
  monthly: 'https://buy.stripe.com/test_6oIdRa6NMcBbfEa3n15AQ01', // £2.99/month
  annual: 'https://buy.stripe.com/test_eVq8wQ1tsfNn63A7Dy5AQ00',  // £20/year
};

// STEP 2: Replace this with your Stripe webhook secret (for backend)
// Get this from: https://dashboard.stripe.com/webhooks
export const STRIPE_WEBHOOK_SECRET = 'whsec_XXXXX'; // REPLACE THIS

/**
 * Opens Stripe payment page for user to subscribe
 * @param {'monthly' | 'annual'} plan - The subscription plan
 * @param {string} userEmail - User's email (optional, will pre-fill Stripe form)
 */
export const initiatePremiumUpgrade = async (plan = 'annual', userEmail = '') => {
  try {
    let paymentUrl = STRIPE_PAYMENT_LINKS[plan];
    
    // Pre-fill email in Stripe checkout
    if (userEmail) {
      paymentUrl += `?prefilled_email=${encodeURIComponent(userEmail)}`;
    }
    
    console.log(`Opening Stripe payment for ${plan} plan...`);
    
    // Check if device can open URL
    const canOpen = await Linking.canOpenURL(paymentUrl);
    
    if (canOpen) {
      // Open Stripe payment page
      await Linking.openURL(paymentUrl);
      
      Alert.alert(
        'Opening Payment Page',
        'Complete your purchase on the Stripe page. Your premium access will activate automatically.',
        [{ text: 'OK' }]
      );
      
      return true;
    } else {
      Alert.alert('Error', 'Could not open payment page. Please try again.');
      return false;
    }
  } catch (error) {
    console.error('Payment initiation error:', error);
    Alert.alert('Error', 'Failed to open payment page. Please try again.');
    return false;
  }
};

/**
 * Verify if user has active premium subscription
 * This requires a backend API endpoint
 * @param {string} userEmail - User's email to check subscription status
 */
export const verifyPremiumStatus = async (userEmail) => {
  try {
    // TODO: Replace with your actual backend API endpoint
    const response = await fetch(`YOUR_BACKEND_URL/api/verify-premium`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: userEmail }),
    });
    
    const data = await response.json();
    return data.isPremium || false;
  } catch (error) {
    console.error('Premium verification error:', error);
    return false;
  }
};

/**
 * Handle when user returns from Stripe payment
 * Call this when app resumes/opens
 */
export const handlePaymentReturn = async (userEmail, updateUserPremiumStatus) => {
  try {
    // Wait a bit for Stripe webhook to process
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check if user is now premium
    const isPremium = await verifyPremiumStatus(userEmail);
    
    if (isPremium) {
      updateUserPremiumStatus(true);
      Alert.alert(
        '🎉 Welcome to Premium!',
        'Your premium subscription is now active. Enjoy unlimited parking searches!',
        [{ text: 'Start Exploring' }]
      );
    }
  } catch (error) {
    console.error('Payment return handling error:', error);
  }
};

// Export pricing for display in app
export const PRICING = {
  monthly: {
    amount: 2.99,
    currency: '£',
    interval: 'month',
    displayPrice: '£2.99/month',
  },
  annual: {
    amount: 20,
    currency: '£',
    interval: 'year',
    displayPrice: '£20/year',
    savings: '£15.88',
    monthlyEquivalent: '£1.67/month',
  },
};

/* 
==============================================
BACKEND WEBHOOK HANDLER (Node.js/Express)
==============================================

This is sample code for your backend server to handle Stripe webhooks.
You'll need to deploy this to handle subscription activations.

// backend/server.js
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const app = express();

// Your database (Firebase, MongoDB, PostgreSQL, etc.)
const database = require('./database');

// Webhook endpoint - Stripe will call this when payments succeed
app.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  let event;
  
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  // Handle successful subscription creation
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    
    // Get customer email from session
    const customerEmail = session.customer_email || session.customer_details?.email;
    
    if (customerEmail) {
      // Update user in database
      await database.updateUser(customerEmail, {
        isPremium: true,
        subscriptionId: session.subscription,
        subscriptionStartDate: new Date(),
      });
      
      console.log(`Premium activated for ${customerEmail}`);
    }
  }
  
  // Handle subscription cancellation
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    
    // Find user by subscription ID
    const user = await database.findUserBySubscription(subscription.id);
    
    if (user) {
      await database.updateUser(user.email, {
        isPremium: false,
        subscriptionEndDate: new Date(),
      });
      
      console.log(`Premium cancelled for ${user.email}`);
    }
  }
  
  res.json({received: true});
});

// API endpoint to check premium status
app.post('/api/verify-premium', express.json(), async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }
  
  try {
    const user = await database.getUser(email);
    res.json({ 
      isPremium: user?.isPremium || false,
      subscriptionId: user?.subscriptionId || null,
    });
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});

==============================================
ALTERNATIVE: Firebase Functions
==============================================

If you use Firebase, here's how to do it with Cloud Functions:

// firebase/functions/index.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const stripe = require('stripe')(functions.config().stripe.secret);

admin.initializeApp();

exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
  const sig = req.headers['stripe-signature'];
  
  let event;
  
  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody,
      sig,
      functions.config().stripe.webhook_secret
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_email || session.customer_details?.email;
    
    if (email) {
      // Update Firestore
      await admin.firestore()
        .collection('users')
        .doc(email)
        .set({
          isPremium: true,
          subscriptionId: session.subscription,
          subscriptionStartDate: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    }
  }
  
  res.json({received: true});
});

exports.verifyPremium = functions.https.onCall(async (data, context) => {
  const email = data.email;
  
  if (!email) {
    throw new functions.https.HttpsError('invalid-argument', 'Email required');
  }
  
  const userDoc = await admin.firestore()
    .collection('users')
    .doc(email)
    .get();
    
  const userData = userDoc.data();
  
  return {
    isPremium: userData?.isPremium || false,
  };
});

==============================================
DEPLOYMENT OPTIONS
==============================================

1. HEROKU (Easiest)
   - Free tier available
   - Deploy in 5 minutes
   - heroku create parkeasy-backend
   - git push heroku main

2. RAILWAY (Modern)
   - Free tier: $5 credit/month
   - GitHub integration
   - Auto-deploys on push

3. FIREBASE FUNCTIONS (Recommended)
   - Pay-as-you-go
   - Free tier: 2M invocations/month
   - Scales automatically

4. VERCEL/NETLIFY (For simple endpoints)
   - Free tier
   - Serverless functions
   - Easy deployment

*/

export default {
  initiatePremiumUpgrade,
  verifyPremiumStatus,
  handlePaymentReturn,
  PRICING,
};
