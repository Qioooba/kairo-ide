<%@ tag body-content="scriptless" pageEncoding="UTF-8" %>
<%@ attribute name="who" required="false" %>
<div class="kairo-hello">
  <p>Hi from a custom tag, ${empty who ? 'stranger' : who}!</p>
</div>
