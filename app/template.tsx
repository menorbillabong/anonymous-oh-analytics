import BulkReviewInjector from './bulk-review-injector';
import SiteUpgrades from './site-upgrades';
import PostSortEnhancer from './post-sort-enhancer';
import SettingsPersistenceSync from './settings-persistence-sync';
import PixDonation from './pix-donation';
import {SiteLanguageProvider} from './site-language';
import './site-upgrades.css';
import './full-settings-v2.css';
import './color-customization.css';
import './mobile-accessibility.css';
// Single automatic refresh timer is mounted from app/page.tsx.
export default function Template({children}:{children:React.ReactNode}){return <SiteLanguageProvider>{children}<BulkReviewInjector/><SiteUpgrades/><PostSortEnhancer/><SettingsPersistenceSync/><PixDonation/></SiteLanguageProvider>}

