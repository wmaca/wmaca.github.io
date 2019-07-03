import React from "react"
import { Link, useStaticQuery, graphql } from "gatsby"
import Image from "gatsby-image"

import { rhythm, scale } from "../utils/typography"

function Layout(props) {
  const data = useStaticQuery(graphql`
    query LogoQuery {
      logo: file(absolutePath: { regex: "/logo.png/" }) {
        childImageSharp {
          fixed(height: 110) {
            ...GatsbyImageSharpFixed_tracedSVG
          }
        }
      }
    }
  `)

  const { location, title, children } = props
  const rootPath = `${__PATH_PREFIX__}/`

  const headerTitle = (
    <Link
      style={{
        boxShadow: `none`,
      }}
      to={`/`}
    >
      <Image fixed={data.logo.childImageSharp.fixed} alt={title}></Image>
    </Link>
  )

  const header =
    location.pathname === rootPath ? (
      <h1
        style={{
          ...scale(1.5),
          marginBottom: rhythm(1.5),
          marginTop: 0,
          textAlign: `center`,
        }}
      >
        {headerTitle}
      </h1>
    ) : (
      <h3
        style={{
          fontFamily: `Montserrat, sans-serif`,
          marginTop: 0,
          textAlign: `center`,
        }}
      >
        {headerTitle}
      </h3>
    )

  return (
    <div
      style={{
        marginLeft: `auto`,
        marginRight: `auto`,
        maxWidth: rhythm(24),
        padding: `${rhythm(1.5)} ${rhythm(3 / 4)}`,
      }}
    >
      <header>{header}</header>
      <main>{children}</main>
      <footer
        style={{ textAlign: `center`, color: `#999`, marginTop: rhythm(3.5) }}
      >
        © Copyright {new Date().getFullYear()},{" "}
        <a href="https://macambira.co">Walter Macambira</a>. Powered by{" "}
        <a href="https://www.gatsbyjs.org">Gatsby</a>.
      </footer>
    </div>
  )
}

export default Layout
