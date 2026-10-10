/**
 * speakga-redirect — sends speakga.com and www.speakga.com to speakga.org.
 *
 * Every request gets a permanent redirect to the same path and query string on
 * speakga.org, so old or mistyped links (speakga.com/?ref=flyer) still land.
 */
export default {
  fetch(request: Request): Response {
    const url = new URL(request.url);
    return Response.redirect(`https://speakga.org${url.pathname}${url.search}`, 301);
  },
};
