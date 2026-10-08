import './ui/analyticsConsent.css';
import {createBrowserAnalytics} from './analytics/browser';
import {bindGuidePrivacy} from './ui/analyticsConsent';
const analytics=createBrowserAnalytics('guide');
bindGuidePrivacy(analytics,document.getElementById('privacy')!);
