-- ─────────────────────────────────────────────────────────────────────────────
-- SEED: Proposal Service Templates with full section content
-- Run this AFTER migration_proposal_engine.sql
-- ─────────────────────────────────────────────────────────────────────────────

DELETE FROM proposal_service_templates;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TEMPLATE 1: Social Media Marketing
-- ═══════════════════════════════════════════════════════════════════════════════
INSERT INTO proposal_service_templates (service_key, service_name, sections) VALUES (
'smm', 'Social Media Marketing', JSON_ARRAY(
  JSON_OBJECT('key','cover','title','Cover Page','type','cover','default_content', NULL),
  JSON_OBJECT('key','executive_summary','title','Executive Summary','type','text','default_content',
    'We propose a comprehensive social media marketing strategy designed to elevate your brand presence, engage your target audience, and drive measurable growth across all major platforms. Our data-driven approach combines creative content with strategic planning to deliver consistent results.'),
  JSON_OBJECT('key','current_presence','title','Current Social Presence','type','text','default_content',
    'Based on our initial assessment, we will conduct a thorough audit of your current social media presence including follower demographics, engagement rates, content performance, and competitive positioning.'),
  JSON_OBJECT('key','challenges','title','Challenges','type','list','default_content', NULL),
  JSON_OBJECT('key','opportunities','title','Opportunities','type','list','default_content', NULL),
  JSON_OBJECT('key','strategy','title','Social Media Strategy','type','text','default_content',
    'Our strategy focuses on three pillars: Brand Awareness through consistent visual identity and storytelling, Audience Engagement through interactive content and community management, and Lead Generation through targeted campaigns and compelling calls-to-action. We will optimize posting schedules based on audience activity patterns and platform algorithms.'),
  JSON_OBJECT('key','content_plan','title','Content Plan','type','text','default_content',
    'We will create a structured content calendar with a balanced mix of educational posts (30%), promotional content (20%), engagement posts (25%), and user-generated/community content (25%). Content formats will include static graphics, carousels, short-form videos (Reels/Shorts), stories, and live sessions.'),
  JSON_OBJECT('key','deliverables','title','Deliverables','type','list','default_content',
    JSON_ARRAY('Monthly content calendar with 20-30 posts','Custom graphic designs for each post','Short-form video content (4-8 Reels/month)','Story content and highlights management','Community management and engagement','Monthly performance report with insights','Competitor monitoring and trend analysis','Hashtag strategy and optimization')),
  JSON_OBJECT('key','expected_outcomes','title','Expected Outcomes','type','list','default_content', NULL),
  JSON_OBJECT('key','case_studies','title','Case Studies','type','case_studies','default_content', NULL),
  JSON_OBJECT('key','timeline','title','Timeline','type','timeline','default_content',
    JSON_ARRAY('Week 1-2: Account audit, strategy development, content calendar creation','Week 3-4: Content production begins, first posts go live','Month 2: Full execution, engagement optimization, first report','Month 3+: Ongoing optimization based on data and performance insights')),
  JSON_OBJECT('key','investment','title','Investment','type','pricing','default_content', NULL),
  JSON_OBJECT('key','next_steps','title','Next Steps','type','steps','default_content',
    JSON_ARRAY('Accept this proposal','Kickoff call scheduled within 24 hours','Strategy document shared within 3 days','Content calendar approved and execution begins within 7 days'))
));

-- ═══════════════════════════════════════════════════════════════════════════════
-- TEMPLATE 2: Website Development
-- ═══════════════════════════════════════════════════════════════════════════════
INSERT INTO proposal_service_templates (service_key, service_name, sections) VALUES (
'website_dev', 'Website Development', JSON_ARRAY(
  JSON_OBJECT('key','cover','title','Cover Page','type','cover','default_content', NULL),
  JSON_OBJECT('key','executive_summary','title','Executive Summary','type','text','default_content',
    'We propose to design and develop a modern, high-performance website that effectively represents your brand, engages visitors, and converts them into customers. Our approach prioritizes user experience, mobile responsiveness, and search engine optimization from the ground up.'),
  JSON_OBJECT('key','current_analysis','title','Current Website Analysis','type','text','default_content',
    'We will conduct a comprehensive analysis of your current web presence including design assessment, performance metrics, SEO health, mobile responsiveness, and user experience evaluation.'),
  JSON_OBJECT('key','challenges','title','Website Challenges','type','list','default_content', NULL),
  JSON_OBJECT('key','objectives','title','Website Objectives','type','list','default_content', NULL),
  JSON_OBJECT('key','proposed_structure','title','Proposed Website Structure','type','text','default_content',
    'The website will follow a clear information architecture designed for intuitive navigation. Key pages will include Home, About Us, Services (with individual service pages), Portfolio/Work, Testimonials, Blog, and Contact. The structure ensures visitors can find information within 3 clicks.'),
  JSON_OBJECT('key','features','title','Features & Functionalities','type','list','default_content',
    JSON_ARRAY('Responsive design (mobile, tablet, desktop)','SEO-optimized page structure and meta tags','Fast loading speed (under 3 seconds)','Contact forms with email notifications','WhatsApp chat integration','Google Maps integration','Social media feed integration','SSL certificate and security','Admin panel for content updates','Google Analytics and tracking setup')),
  JSON_OBJECT('key','pages_included','title','Pages Included','type','list','default_content',
    JSON_ARRAY('Home Page (with hero section, services overview, testimonials)','About Us Page','Services Page (with individual service detail pages)','Portfolio/Gallery Page','Contact Us Page (with form, map, details)','Blog Page (if required)','Privacy Policy & Terms')),
  JSON_OBJECT('key','tech_specs','title','Technical Specifications','type','text','default_content',
    'Technology Stack: Modern frontend framework with responsive CSS, optimized for Core Web Vitals. Hosting on high-performance cloud servers with 99.9% uptime. CDN integration for fast global delivery. Automatic daily backups and SSL encryption.'),
  JSON_OBJECT('key','timeline','title','Project Timeline','type','timeline','default_content',
    JSON_ARRAY('Week 1: Requirement gathering, wireframe design, sitemap finalization','Week 2: UI/UX design mockups and client approval','Week 3-4: Frontend development and responsive implementation','Week 5: Backend integration, forms, CMS setup','Week 6: Testing, optimization, content upload','Week 7: Client review, revisions, and launch')),
  JSON_OBJECT('key','investment','title','Investment','type','pricing','default_content', NULL),
  JSON_OBJECT('key','next_steps','title','Next Steps','type','steps','default_content',
    JSON_ARRAY('Accept this proposal','Kickoff call to finalize requirements','Wireframes shared within 5 days','Design mockups for approval within 10 days','Development begins post design approval','Launch within 6-7 weeks'))
));

-- ═══════════════════════════════════════════════════════════════════════════════
-- TEMPLATE 3: SEO
-- ═══════════════════════════════════════════════════════════════════════════════
INSERT INTO proposal_service_templates (service_key, service_name, sections) VALUES (
'seo', 'SEO', JSON_ARRAY(
  JSON_OBJECT('key','cover','title','Cover Page','type','cover','default_content', NULL),
  JSON_OBJECT('key','executive_summary','title','Executive Summary','type','text','default_content',
    'We propose a comprehensive SEO strategy to improve your website visibility on search engines, drive quality organic traffic, and generate consistent leads without paid advertising. Our white-hat approach ensures sustainable long-term rankings.'),
  JSON_OBJECT('key','current_analysis','title','Current SEO Analysis','type','text','default_content',
    'We will perform a full SEO audit covering technical health, on-page optimization, content quality, backlink profile, keyword rankings, and competitor positioning to establish a baseline and identify quick wins.'),
  JSON_OBJECT('key','challenges','title','SEO Challenges','type','list','default_content', NULL),
  JSON_OBJECT('key','keyword_opportunities','title','Keyword Opportunities','type','text','default_content',
    'We will research and target a mix of high-volume head keywords, medium-competition body keywords, and high-intent long-tail keywords specific to your industry and location. Focus will be on keywords with clear commercial or transactional intent.'),
  JSON_OBJECT('key','tech_seo','title','Technical SEO Issues','type','text','default_content',
    'Technical optimization will cover site speed, mobile usability, crawlability, indexation issues, schema markup, XML sitemap, robots.txt configuration, canonical tags, and Core Web Vitals compliance.'),
  JSON_OBJECT('key','strategy','title','SEO Strategy','type','text','default_content',
    'Our SEO strategy combines On-Page Optimization (content, meta tags, internal linking, keyword placement), Off-Page SEO (quality backlink building, guest posting, directory submissions), Technical SEO (speed, mobile, schema), and Local SEO (Google Business Profile optimization, local citations, reviews management).'),
  JSON_OBJECT('key','monthly_activities','title','Monthly SEO Activities','type','list','default_content',
    JSON_ARRAY('Keyword tracking and ranking report','2-4 SEO-optimized blog posts','On-page optimization of existing pages','Technical SEO fixes and monitoring','Backlink building (5-10 quality links/month)','Google Business Profile updates','Competitor monitoring and strategy adjustments','Monthly performance report with actionable insights')),
  JSON_OBJECT('key','expected_outcomes','title','Expected Growth','type','list','default_content',
    JSON_ARRAY('Month 1-2: Technical fixes, content foundation, initial indexing improvements','Month 3-4: Ranking improvements for long-tail keywords, traffic increase begins','Month 5-6: Significant organic traffic growth, lead generation from search','Month 6+: Sustained rankings, authority building, compound growth')),
  JSON_OBJECT('key','timeline','title','Timeline','type','timeline','default_content',
    JSON_ARRAY('Month 1: Full audit, strategy development, technical fixes, keyword mapping','Month 2: On-page optimization, content creation begins, link building starts','Month 3: Content scaling, rankings tracking, first results visible','Month 4-6: Full execution, optimization cycles, measurable growth')),
  JSON_OBJECT('key','investment','title','Investment','type','pricing','default_content', NULL),
  JSON_OBJECT('key','next_steps','title','Next Steps','type','steps','default_content',
    JSON_ARRAY('Accept this proposal','Full SEO audit delivered within 5 days','Strategy document and keyword map shared','Execution begins within 10 days of approval','First ranking report at end of Month 1'))
));

-- ═══════════════════════════════════════════════════════════════════════════════
-- TEMPLATE 4: Performance Marketing
-- ═══════════════════════════════════════════════════════════════════════════════
INSERT INTO proposal_service_templates (service_key, service_name, sections) VALUES (
'performance_marketing', 'Performance Marketing', JSON_ARRAY(
  JSON_OBJECT('key','cover','title','Cover Page','type','cover','default_content', NULL),
  JSON_OBJECT('key','executive_summary','title','Executive Summary','type','text','default_content',
    'We propose a results-driven performance marketing strategy focused on generating quality leads and maximizing your return on ad spend (ROAS). Through targeted campaigns across Meta, Google, and relevant platforms, we will build a predictable lead generation engine for your business.'),
  JSON_OBJECT('key','current_analysis','title','Current Marketing Situation','type','text','default_content',
    'We will analyze your current advertising efforts, past campaign performance, audience data, and conversion metrics to establish benchmarks and identify optimization opportunities.'),
  JSON_OBJECT('key','challenges','title','Challenges','type','list','default_content', NULL),
  JSON_OBJECT('key','target_audience','title','Target Audience','type','text','default_content',
    'We will define detailed audience segments based on demographics, interests, behaviors, and lookalike audiences from your existing customer data. Campaign targeting will be refined through A/B testing and performance data.'),
  JSON_OBJECT('key','funnel_strategy','title','Funnel Strategy','type','text','default_content',
    'Our full-funnel approach: TOFU (Awareness) — Video ads, carousel posts to introduce brand. MOFU (Consideration) — Retargeting with testimonials, case studies, offers. BOFU (Conversion) — Direct response ads, lead forms, landing pages with clear CTAs. Each stage has specific KPIs and optimization triggers.'),
  JSON_OBJECT('key','campaign_structure','title','Campaign Structure','type','text','default_content',
    'Campaigns will be structured with clear objectives per platform. Meta Ads: Brand awareness campaigns, lead generation campaigns, retargeting campaigns. Google Ads: Search campaigns for high-intent keywords, Display campaigns for remarketing. Each campaign will have multiple ad sets for A/B testing audiences and creatives.'),
  JSON_OBJECT('key','creative_strategy','title','Creative Strategy','type','text','default_content',
    'Ad creatives will include a mix of formats optimized for each platform: Video ads (15-30 seconds), Static graphics with strong CTAs, Carousel ads showcasing services/results, Testimonial-based creatives, and UGC-style content. We will produce 8-12 creative variations monthly for testing.'),
  JSON_OBJECT('key','lead_gen_process','title','Lead Generation Process','type','steps','default_content',
    JSON_ARRAY('Audience sees targeted ad creative','Clicks to optimized landing page or lead form','Submits enquiry with contact details','Lead notification sent to your team instantly','Follow-up within 5 minutes for best conversion','Lead tracked in CRM with source attribution')),
  JSON_OBJECT('key','expected_outcomes','title','Expected Outcomes','type','list','default_content', NULL),
  JSON_OBJECT('key','ad_budget','title','Ad Budget Recommendation','type','text','default_content',
    'Recommended monthly ad spend will be allocated across platforms based on audience presence and campaign objectives. Budget split will be optimized weekly based on performance data. We recommend starting with a testing phase (2 weeks) before scaling winning campaigns.'),
  JSON_OBJECT('key','timeline','title','Timeline','type','timeline','default_content',
    JSON_ARRAY('Week 1: Audience research, campaign strategy, creative briefing','Week 2: Landing page setup, creative production, pixel/tracking setup','Week 3: Campaign launch, initial testing phase','Week 4: Data analysis, optimization, scale winning ads','Month 2+: Ongoing optimization, creative refresh, scaling')),
  JSON_OBJECT('key','investment','title','Investment','type','pricing','default_content', NULL),
  JSON_OBJECT('key','next_steps','title','Next Steps','type','steps','default_content',
    JSON_ARRAY('Accept this proposal','Kickoff call for targeting and creative direction','Ad accounts and tracking setup within 3 days','Creatives produced and campaigns live within 7 days','First performance report at end of Week 2'))
));

-- ═══════════════════════════════════════════════════════════════════════════════
-- TEMPLATE 5: Personal Branding
-- ═══════════════════════════════════════════════════════════════════════════════
INSERT INTO proposal_service_templates (service_key, service_name, sections) VALUES (
'personal_branding', 'Personal Branding', JSON_ARRAY(
  JSON_OBJECT('key','cover','title','Cover Page','type','cover','default_content', NULL),
  JSON_OBJECT('key','executive_summary','title','Executive Summary','type','text','default_content',
    'We propose a comprehensive personal branding strategy to position you as a recognized authority in your field. Through consistent content, strategic positioning, and audience building, we will create a powerful personal brand that generates trust, opportunities, and business growth.'),
  JSON_OBJECT('key','brand_assessment','title','Personal Brand Assessment','type','text','default_content',
    'We will evaluate your current online presence, existing content, audience perception, and competitive landscape to identify your unique strengths, differentiation opportunities, and the gap between where you are and where you want to be.'),
  JSON_OBJECT('key','positioning','title','Positioning Analysis','type','text','default_content', NULL),
  JSON_OBJECT('key','audience','title','Audience Analysis','type','text','default_content', NULL),
  JSON_OBJECT('key','content_strategy','title','Content Strategy','type','text','default_content', NULL),
  JSON_OBJECT('key','platform_strategy','title','Platform Strategy','type','text','default_content',
    'We will identify the 2-3 platforms where your target audience is most active and build a focused presence. Primary platform for long-form thought leadership (LinkedIn/YouTube), secondary platform for daily engagement (Instagram/Twitter), and supporting channels for content repurposing.'),
  JSON_OBJECT('key','deliverables','title','Deliverables','type','list','default_content',
    JSON_ARRAY('Personal brand strategy document','Content calendar with 15-20 posts/month','Professional graphics and visual identity','Video content scripting and editing (4-6 videos/month)','LinkedIn optimization and thought leadership posts','Instagram/Twitter content and engagement','Profile optimization across all platforms','Monthly brand growth report')),
  JSON_OBJECT('key','growth_roadmap','title','Growth Roadmap','type','timeline','default_content',
    JSON_ARRAY('Month 1: Brand audit, positioning, visual identity, profile optimization','Month 2: Content engine starts, first posts go live, engagement begins','Month 3: Authority building, collaborations, audience growth acceleration','Month 4-6: Scaling reach, speaking opportunities, inbound leads from brand','Month 6+: Established authority, consistent inbound, brand monetization')),
  JSON_OBJECT('key','expected_outcomes','title','Expected Outcomes','type','list','default_content', NULL),
  JSON_OBJECT('key','timeline','title','Timeline','type','timeline','default_content',
    JSON_ARRAY('Week 1-2: Brand audit, positioning strategy, visual identity design','Week 3-4: Content calendar creation, first batch of content produced','Month 2: Full content execution, engagement strategy active','Month 3+: Growth optimization, authority building, results tracking')),
  JSON_OBJECT('key','investment','title','Investment','type','pricing','default_content', NULL),
  JSON_OBJECT('key','next_steps','title','Next Steps','type','steps','default_content',
    JSON_ARRAY('Accept this proposal','Brand discovery session (60 mins)','Strategy and visual identity delivered within 7 days','Content calendar approved and execution begins','First growth report at end of Month 1'))
));

-- ═══════════════════════════════════════════════════════════════════════════════
-- SEED: Industry Blocks (sample content for each industry × service)
-- ═══════════════════════════════════════════════════════════════════════════════

DELETE FROM proposal_industry_blocks;

-- Education × SMM
INSERT INTO proposal_industry_blocks (industry_key, industry_name, service_key, executive_summary, challenges, opportunities, expected_outcomes) VALUES
('education', 'Education', 'smm',
  'We will build a powerful social media presence for your educational institution that connects with parents, students, and the community. Our strategy focuses on showcasing academic excellence, campus life, and student achievements to drive admissions and build trust.',
  JSON_ARRAY('Low parent awareness about programs and facilities','Difficulty reaching new families in the area','Inconsistent social media presence','Competition from other institutions with stronger online visibility'),
  JSON_ARRAY('Showcase student achievements and campus events','Build parent community through engaging content','Highlight unique programs and teaching methodology','Leverage video content for virtual campus tours'),
  JSON_ARRAY('Increase in enquiries from social media by 40-60%','Strong parent community engagement online','Higher brand recall in the local area','Consistent flow of admission enquiries during season')
);

-- Education × Website Dev
INSERT INTO proposal_industry_blocks (industry_key, industry_name, service_key, executive_summary, challenges, opportunities, expected_outcomes) VALUES
('education', 'Education', 'website_dev',
  'We will create a modern, informative website for your institution that serves as the primary touchpoint for prospective parents and students. The site will showcase your values, facilities, programs, and make the admission process seamless.',
  JSON_ARRAY('Outdated website that does not reflect current standards','No online admission enquiry system','Mobile experience is poor for parent browsing','Difficult to update content and announcements'),
  JSON_ARRAY('Online admission forms and enquiry system','Virtual campus tour with photos and videos','Parent portal for updates and communication','Blog for educational content and SEO'),
  JSON_ARRAY('50%+ enquiries coming through website','Reduced phone calls for basic information','Higher trust factor from professional online presence','Better Google ranking for local education searches')
);

-- Real Estate × SMM
INSERT INTO proposal_industry_blocks (industry_key, industry_name, service_key, executive_summary, challenges, opportunities, expected_outcomes) VALUES
('real_estate', 'Real Estate', 'smm',
  'We will create a high-impact social media strategy for your real estate business focused on generating quality leads, showcasing properties, and building trust with potential buyers and investors through compelling visual content and targeted campaigns.',
  JSON_ARRAY('Low site visits and lead generation from digital','Difficulty standing out among competing projects','Long sales cycle with no digital nurturing','Inconsistent brand presence across platforms'),
  JSON_ARRAY('Virtual property tours and walkthrough videos','Targeted location-based advertising','Testimonial and success story content','Community building around lifestyle and location benefits'),
  JSON_ARRAY('Consistent flow of qualified property enquiries','Higher site visit bookings from social media','Improved brand perception and trust','Better lead quality through targeted content')
);

-- Real Estate × Performance Marketing
INSERT INTO proposal_industry_blocks (industry_key, industry_name, service_key, executive_summary, challenges, opportunities, expected_outcomes) VALUES
('real_estate', 'Real Estate', 'performance_marketing',
  'We will build a high-performance lead generation system for your real estate projects using Meta and Google Ads. Our focus is on generating qualified site visit bookings through precision targeting, compelling creatives, and optimized landing pages.',
  JSON_ARRAY('High cost per lead from current campaigns','Low quality leads that dont convert to site visits','No proper tracking of lead-to-sale journey','Creative fatigue and audience saturation'),
  JSON_ARRAY('Lookalike audiences from existing buyers','Video walkthroughs as ad creatives','Location-targeted campaigns for nearby audiences','Retargeting website visitors and page engagers'),
  JSON_ARRAY('Cost per qualified lead reduction by 30-50%','Consistent 50-100+ leads per month','Site visit conversion rate improvement','Clear ROI tracking from ad spend to bookings')
);

-- Restaurant × SMM
INSERT INTO proposal_industry_blocks (industry_key, industry_name, service_key, executive_summary, challenges, opportunities, expected_outcomes) VALUES
('restaurant', 'Restaurant & Hospitality', 'smm',
  'We will create a mouth-watering social media presence for your restaurant that drives footfall, builds a loyal community, and positions your brand as the go-to dining destination. Our strategy combines stunning food photography, engaging content, and local targeting.',
  JSON_ARRAY('Low awareness among new residents in the area','Inconsistent posting and no content strategy','Difficulty competing with food delivery app visibility','No community engagement or customer retention strategy'),
  JSON_ARRAY('Food photography and behind-the-scenes content','Influencer collaborations and food blogger visits','User-generated content from customer posts','Seasonal campaigns and festival special promotions'),
  JSON_ARRAY('Increase in walk-in customers from social media','Growing follower base of food enthusiasts','Higher engagement and community interaction','Consistent reservation and order inquiries')
);

-- Fashion × SMM
INSERT INTO proposal_industry_blocks (industry_key, industry_name, service_key, executive_summary, challenges, opportunities, expected_outcomes) VALUES
('fashion', 'Clothing & Fashion', 'smm',
  'We will build an aspirational brand presence for your fashion business that showcases your collections, connects with fashion-conscious audiences, and drives online and in-store sales through visually stunning content and influencer collaborations.',
  JSON_ARRAY('Low brand visibility among target demographic','No consistent visual aesthetic on social media','Difficulty converting followers to customers','Competition from fast-fashion and online-first brands'),
  JSON_ARRAY('Lifestyle and lookbook content that inspires','Influencer partnerships and styling collaborations','Shoppable posts and seamless purchase journey','Seasonal collection launches with buzz campaigns'),
  JSON_ARRAY('Increased brand awareness and follower growth','Higher engagement on product posts','Direct sales enquiries and store visits from social','Strong brand identity and aesthetic recognition')
);

-- Other (Generic) × SMM
INSERT INTO proposal_industry_blocks (industry_key, industry_name, service_key, executive_summary, challenges, opportunities, expected_outcomes) VALUES
('other', 'Other', 'smm',
  'We will create a tailored social media strategy for your business that builds brand awareness, engages your target audience, and generates measurable results. Our approach is customized based on your specific industry, goals, and competitive landscape.',
  JSON_ARRAY('Low brand awareness in target market','Inconsistent social media presence','No clear content strategy or posting schedule','Difficulty measuring social media ROI'),
  JSON_ARRAY('Build thought leadership in your niche','Engage directly with potential customers','Showcase expertise through educational content','Leverage trending formats for maximum reach'),
  JSON_ARRAY('Significant growth in brand visibility','Higher engagement and community building','Consistent lead generation from social channels','Measurable improvement in brand metrics')
);
