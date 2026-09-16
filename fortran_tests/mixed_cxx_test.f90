program mixed_cxx_test
  use, intrinsic :: iso_c_binding, only: c_char, c_int
  implicit none

  interface
    function cxx_word_count(sentence, length) bind(C, name="cxx_word_count")
      use, intrinsic :: iso_c_binding, only: c_char, c_int
      implicit none

      character(kind=c_char), intent(in) :: sentence(*)
      integer(c_int), value :: length
      integer(c_int) :: cxx_word_count
    end function cxx_word_count
  end interface

  character(len=64) :: sentence
  integer(c_int) :: count

  sentence = "setup fortran cxx companion"
  count = cxx_word_count(sentence, int(len_trim(sentence), kind=c_int))

  if (count == 4) then
    print *, "Mixed C++/Fortran compile/link: OK"
  else
    print *, "Mixed C++/Fortran compile/link: FAILED"
    stop 1
  end if

end program mixed_cxx_test
