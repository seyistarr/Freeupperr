// Loss of a staging session must not turn a requested restricted post Public.
export function disableRestrictedAudiences(selector) {
 const requested=selector.value;
 for(const option of selector.options)if(option.value!=='public')option.disabled=true;
 // Keep the privacy intent even if disabling an option changes native selection.
 if(['followers','friends','only_me'].includes(requested))selector.value=requested;
}
