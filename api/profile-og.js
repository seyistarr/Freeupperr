import React from 'react';
import { ImageResponse } from '@vercel/og';

const SUPABASE_URL =
  'https://jmjtqidirpmnegzvmiaq.supabase.co';

const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY;

const SITE_URL =
  'https://freeupper.vercel.app';

const FALLBACK_IMAGE =
  `${SITE_URL}/freeupper.png`;

const WIDTH = 1200;
const HEIGHT = 630;

/*
 * Clean the FreeUpper ID coming from the URL.
 */
function cleanId(value = '') {
  return String(value)
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 100);
}

/*
 * Clean profile text before putting it into the OG image.
 */
function cleanText(value = '', max = 180) {
  return String(value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/*
 * Get a profile from Supabase using the FreeUpper ID.
 */
async function getProfile(freeupperId) {
  if (!SUPABASE_ANON_KEY) {
    throw new Error(
      'SUPABASE_ANON_KEY is not configured'
    );
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/get_profile_by_freeupper_id`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        p_freeupper_id: freeupperId
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Supabase lookup failed: ${response.status} ${errorText}`
    );
  }

  const data = await response.json();

  if (Array.isArray(data)) {
    return data[0] || null;
  }

  return data || null;
}

/*
 * Make sure an image URL is actually usable.
 *
 * We DO NOT download the image here.
 * The previous version downloaded Cloudinary images,
 * which was causing the 5-second AbortError.
 */
function cleanImageUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(String(value));

    if (
      parsed.protocol !== 'http:' &&
      parsed.protocol !== 'https:'
    ) {
      return null;
    }

    return parsed.href;
  } catch {
    return null;
  }
}

/*
 * Main Vercel function.
 */
export default async function handler(req, res) {
  try {
    const requestUrl = new URL(
      req.url,
      `https://${req.headers.host || 'freeupper.vercel.app'}`
    );

    /*
     * Main expected URL:
     *
     * /api/profile-og?freeupper_id=FU32FAD1335800
     */
    const freeupperId = cleanId(
      requestUrl.searchParams.get('freeupper_id') || ''
    );

    if (!freeupperId) {
      res.statusCode = 400;
      res.setHeader(
        'Content-Type',
        'text/plain; charset=utf-8'
      );

      return res.end(
        'Missing freeupper_id'
      );
    }

    /*
     * Get the profile.
     */
    const profile = await getProfile(
      freeupperId
    );

    if (!profile) {
      res.statusCode = 404;
      res.setHeader(
        'Content-Type',
        'text/plain; charset=utf-8'
      );

      return res.end(
        'Profile not found'
      );
    }

    /*
     * Profile information.
     */
    const displayName =
      cleanText(
        profile.display_name,
        80
      ) ||
      cleanText(
        profile.username,
        80
      ) ||
      'FreeUpper User';

    const username =
      cleanText(
        profile.username ||
        profile.display_username ||
        '',
        80
      );

    const bio =
      cleanText(
        profile.bio,
        180
      ) ||
      `Connect with ${displayName} on FreeUpper.`;

    /*
     * Do not fetch Cloudinary images ourselves.
     *
     * Just pass the URL to ImageResponse.
     */
    const avatar =
      cleanImageUrl(
        profile.avatar_url
      );

    const logo =
      cleanImageUrl(
        FALLBACK_IMAGE
      );

    /*
     * Use the user's avatar if available.
     * Otherwise use the FreeUpper logo.
     */
    const avatarSource =
      avatar || logo;

    /*
     * Build the OG image.
     */
    const image =
      React.createElement(
        'div',
        {
          style: {
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            background: '#ffffff',
            color: '#111827',
            fontFamily: 'Arial, sans-serif',
            position: 'relative',
            overflow: 'hidden'
          }
        },

        /*
         * Top-right purple decoration.
         */
        React.createElement(
          'div',
          {
            style: {
              position: 'absolute',
              width: 520,
              height: 520,
              borderRadius: 260,
              background: '#f3e8ff',
              right: -180,
              top: -220
            }
          }
        ),

        /*
         * Bottom-left purple decoration.
         */
        React.createElement(
          'div',
          {
            style: {
              position: 'absolute',
              width: 420,
              height: 420,
              borderRadius: 210,
              background: '#ede9fe',
              left: -220,
              bottom: -220
            }
          }
        ),

        /*
         * Main content container.
         */
        React.createElement(
          'div',
          {
            style: {
              position: 'relative',
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              padding: '50px 70px'
            }
          },

          /*
           * HEADER
           */
          React.createElement(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center'
              }
            },

            /*
             * FreeUpper logo.
             */
            logo
              ? React.createElement(
                  'img',
                  {
                    src: logo,
                    width: 58,
                    height: 58,
                    style: {
                      borderRadius: 14,
                      objectFit: 'cover'
                    }
                  }
                )
              : null,

            /*
             * FreeUpper text.
             */
            React.createElement(
              'div',
              {
                style: {
                  display: 'flex',
                  marginLeft: 16,
                  fontSize: 34,
                  fontWeight: 700
                }
              },
              'FreeUpper'
            )
          ),

          /*
           * PROFILE AREA
           */
          React.createElement(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                flex: 1,
                marginTop: 25
              }
            },

            /*
             * AVATAR
             */
            React.createElement(
              'div',
              {
                style: {
                  display: 'flex',
                  width: 230,
                  height: 230,
                  padding: 7,
                  borderRadius: 115,
                  background: '#8b5cf6',
                  flexShrink: 0
                }
              },

              avatarSource
                ? React.createElement(
                    'img',
                    {
                      src: avatarSource,
                      width: 216,
                      height: 216,
                      style: {
                        borderRadius: 108,
                        objectFit: 'cover',
                        background: '#ffffff'
                      }
                    }
                  )
                : React.createElement(
                    'div',
                    {
                      style: {
                        display: 'flex',
                        width: 216,
                        height: 216,
                        borderRadius: 108,
                        background: '#ffffff',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 70,
                        fontWeight: 700,
                        color: '#8b5cf6'
                      }
                    },
                    'F'
                  )
            ),

            /*
             * PROFILE TEXT
             */
            React.createElement(
              'div',
              {
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  marginLeft: 55,
                  maxWidth: 700
                }
              },

              /*
               * Display name.
               */
              React.createElement(
                'div',
                {
                  style: {
                    display: 'flex',
                    fontSize: 52,
                    lineHeight: 1.1,
                    fontWeight: 700
                  }
                },
                displayName
              ),

              /*
               * Username.
               */
              username
                ? React.createElement(
                    'div',
                    {
                      style: {
                        display: 'flex',
                        marginTop: 12,
                        fontSize: 30,
                        color: '#7c3aed',
                        fontWeight: 600
                      }
                    },
                    `@${username}`
                  )
                : null,

              /*
               * Bio.
               */
              React.createElement(
                'div',
                {
                  style: {
                    display: 'flex',
                    marginTop: 20,
                    fontSize: 25,
                    lineHeight: 1.35,
                    color: '#6b7280',
                    maxWidth: 650
                  }
                },
                bio
              )
            )
          ),

          /*
           * FOOTER
           */
          React.createElement(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }
            },

            /*
             * Slogan.
             */
            React.createElement(
              'div',
              {
                style: {
                  display: 'flex',
                  fontSize: 24,
                  color: '#6b7280'
                }
              },
              'Connect. Share. Be Free.'
            ),

            /*
             * Button-style branding.
             */
            React.createElement(
              'div',
              {
                style: {
                  display: 'flex',
                  padding: '14px 24px',
                  borderRadius: 999,
                  background: '#8b5cf6',
                  color: '#ffffff',
                  fontSize: 22,
                  fontWeight: 700
                }
              },
              'Connect on FreeUpper'
            )
          )
        )
      );

    /*
     * Generate PNG.
     */
    const response =
      new ImageResponse(
        image,
        {
          width: WIDTH,
          height: HEIGHT
        }
      );

    /*
     * Response headers.
     */
    res.statusCode = 200;

    res.setHeader(
      'Content-Type',
      'image/png'
    );

    res.setHeader(
      'Cache-Control',
      'public, max-age=300, s-maxage=300, stale-while-revalidate=3600'
    );

    /*
     * Send generated PNG.
     */
    return res.end(
      Buffer.from(
        await response.arrayBuffer()
      )
    );

  } catch (error) {
    console.error(
      'FreeUpper OG image error:',
      error
    );

    res.statusCode = 500;

    res.setHeader(
      'Content-Type',
      'text/plain; charset=utf-8'
    );

    return res.end(
      'Unable to generate profile preview'
    );
  }
}